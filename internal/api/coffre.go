// Coffre API: the personal password manager ("coffre"), session-guarded
// admin endpoints.
//
// SECURITY INVARIANT — agents can NEVER access the coffre:
//   - every route lives under /admin/* (session auth); the agent API
//     (/v1, API-key auth) and MCP expose no coffre surface at all;
//   - the coffre is end-to-end encrypted IN THE BROWSER: the server
//     stores only opaque blobs. No handler here can decrypt, log or
//     reveal coffre content — there is no server-side coffre key;
//   - audit entries carry actions and opaque IDs only, never names.
//
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/kerviaHerve/kervia-vault/internal/model"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

// Server-side limits — generous for a personal vault, small enough to
// keep the tiny SQLite instance healthy.
const (
	coffreMaxBlob      = 128 << 10 // 128 KiB decoded, per item
	coffreMaxBatch     = 500       // items per import request
	coffreMaxBatchBody = 32 << 20  // 32 MiB import request
	coffreMaxKDFParams = 128       // chars of the KDF params JSON
	coffreMinSaltLen   = 16
	coffreMaxSaltLen   = 32
	coffreMaxSealedLen = 512 // decoded wrapped_key / verifier upper bound
)

// coffreSetupReq is the zero-knowledge envelope: everything but the
// algo name is opaque ciphertext to the server.
type coffreSetupReq struct {
	KDFAlgo    string `json:"kdf_algo"`
	KDFParams  string `json:"kdf_params"`
	KDFSalt    []byte `json:"kdf_salt_b64"`
	WrappedKey []byte `json:"wrapped_key_b64"`
	Verifier   []byte `json:"verifier_b64"`
}

type coffreItemReq struct {
	Blob []byte `json:"blob_b64"`
}

type coffreItemUpdateReq struct {
	Blob            []byte `json:"blob_b64"`
	ExpectedVersion int    `json:"expected_version"`
}

type coffreBatchReq struct {
	Items []coffreItemReq `json:"items"`
}

type coffreDestroyReq struct {
	Confirm string `json:"confirm"`
}

type coffreHeaderResp struct {
	KDFAlgo    string    `json:"kdf_algo"`
	KDFParams  string    `json:"kdf_params"`
	KDFSalt    []byte    `json:"kdf_salt_b64"`
	WrappedKey []byte    `json:"wrapped_key_b64"`
	Verifier   []byte    `json:"verifier_b64"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	ItemCount  int       `json:"item_count"`
	TrashCount int       `json:"trash_count"`
}

// jsonBodyN is jsonBody with a custom size ceiling (imports are big).
func jsonBodyN(r *http.Request, v any, maxBytes int64) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxBytes))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

// validCoffreSetup checks the envelope shape. It cannot check the
// content: the content is encrypted for the user's master password.
func validCoffreSetup(req *coffreSetupReq) string {
	if req.KDFAlgo != "pbkdf2" {
		return "unsupported_kdf" // v1: pbkdf2 (WebCrypto, no WASM, CSP unchanged)
	}
	if len(req.KDFParams) == 0 || len(req.KDFParams) > coffreMaxKDFParams {
		return "invalid_kdf_params"
	}
	if n := len(req.KDFSalt); n < coffreMinSaltLen || n > coffreMaxSaltLen {
		return "invalid_kdf_salt"
	}
	if n := len(req.WrappedKey); n == 0 || n > coffreMaxSealedLen {
		return "invalid_wrapped_key"
	}
	if n := len(req.Verifier); n == 0 || n > coffreMaxSealedLen {
		return "invalid_verifier"
	}
	return ""
}

// CoffreHeader returns the KDF envelope needed to unlock client-side.
// 404 as long as the coffre has not been created (webui shows the
// creation screen).
func (a *AdminServer) CoffreHeader(w http.ResponseWriter, _ *http.Request) {
	meta, err := a.store.GetCoffreMeta()
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, 404, "coffre_not_created", "")
		return
	}
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	live, trashed, err := a.store.CountCoffreItems()
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	writeJSON(w, 200, coffreHeaderResp{
		KDFAlgo: meta.KDFAlgo, KDFParams: meta.KDFParams,
		KDFSalt: meta.KDFSalt, WrappedKey: meta.WrappedKey, Verifier: meta.Verifier,
		CreatedAt: meta.CreatedAt, UpdatedAt: meta.UpdatedAt,
		ItemCount: live, TrashCount: trashed,
	})
}

// CoffreCreate initialises the coffre (stores the client-sealed key
// envelope). Only possible once — a second call is a conflict.
func (a *AdminServer) CoffreCreate(w http.ResponseWriter, r *http.Request) {
	var req coffreSetupReq
	if err := jsonBody(r, &req); err != nil {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	if verr := validCoffreSetup(&req); verr != "" {
		writeErr(w, 400, verr, "")
		return
	}
	if err := a.store.CreateCoffreMeta(req.KDFAlgo, req.KDFParams, req.KDFSalt, req.WrappedKey, req.Verifier); err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeErr(w, 409, "already_exists", "")
			return
		}
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditCoffreCreate, "coffre", "")
	writeJSON(w, 201, map[string]string{"status": "created"})
}

// CoffreRekey replaces the envelope (master password change). The new
// wrapped key was produced client-side from the NEW password after a
// successful unwrap with the old one — the server never verifies (it
// can't) and never sees either password.
func (a *AdminServer) CoffreRekey(w http.ResponseWriter, r *http.Request) {
	var req coffreSetupReq
	if err := jsonBody(r, &req); err != nil {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	if verr := validCoffreSetup(&req); verr != "" {
		writeErr(w, 400, verr, "")
		return
	}
	if err := a.store.RekeyCoffre(req.KDFAlgo, req.KDFParams, req.KDFSalt, req.WrappedKey, req.Verifier); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "coffre_not_created", "")
			return
		}
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditCoffreRekey, "coffre", "")
	writeJSON(w, 200, map[string]string{"status": "rekeyed"})
}

// CoffreDestroy wipes the coffre and every item. Requires an explicit
// typed confirmation from the webui — there is no undo, and (zero
// knowledge) no recovery from the server side.
func (a *AdminServer) CoffreDestroy(w http.ResponseWriter, r *http.Request) {
	var req coffreDestroyReq
	if err := jsonBody(r, &req); err != nil || req.Confirm != "DESTROY" {
		writeErr(w, 400, "confirmation_required", "")
		return
	}
	if _, err := a.store.GetCoffreMeta(); errors.Is(err, store.ErrNotFound) {
		writeErr(w, 404, "coffre_not_created", "")
		return
	} else if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	if err := a.store.DestroyCoffre(); err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditCoffreDestroy, "coffre", "")
	writeJSON(w, 200, map[string]string{"status": "destroyed"})
}

// CoffreListItems returns every opaque blob (trash included). The
// client decrypts what it can with the unwrapped coffre key. No audit
// entry: the server cannot know which items the client decrypts, and
// the generic access log already records the call.
func (a *AdminServer) CoffreListItems(w http.ResponseWriter, _ *http.Request) {
	items, err := a.store.ListCoffreItems()
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	writeJSON(w, 200, items)
}

// CoffreCreateItem stores one new opaque blob.
func (a *AdminServer) CoffreCreateItem(w http.ResponseWriter, r *http.Request) {
	var req coffreItemReq
	if err := jsonBody(r, &req); err != nil || len(req.Blob) == 0 {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	if len(req.Blob) > coffreMaxBlob {
		writeErr(w, 413, "blob_too_large", "")
		return
	}
	item, err := a.store.CreateCoffreItem(uuid.NewString(), req.Blob)
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditCoffreItemCreate, "coffre/item/"+item.ID, "")
	writeJSON(w, 201, item)
}

// CoffreImportItems stores many opaque blobs in one transaction
// (Bitwarden/Vaultwarden import). All-or-nothing.
func (a *AdminServer) CoffreImportItems(w http.ResponseWriter, r *http.Request) {
	var req coffreBatchReq
	if err := jsonBodyN(r, &req, coffreMaxBatchBody); err != nil || len(req.Items) == 0 {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	if len(req.Items) > coffreMaxBatch {
		writeErr(w, 413, "too_many_items", "")
		return
	}
	ids := make([]string, len(req.Items))
	blobs := make([][]byte, len(req.Items))
	for i, it := range req.Items {
		if len(it.Blob) == 0 || len(it.Blob) > coffreMaxBlob {
			writeErr(w, 400, "invalid_blob", "")
			return
		}
		ids[i] = uuid.NewString()
		blobs[i] = it.Blob
	}
	if err := a.store.CreateCoffreItems(ids, blobs); err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditCoffreImport, "coffre/items", "")
	writeJSON(w, 201, map[string]int{"created": len(ids)})
}

// CoffreUpdateItem replaces a blob with optimistic concurrency on
// version: two tabs editing the same item cannot silently overwrite
// each other.
func (a *AdminServer) CoffreUpdateItem(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" || len(id) > 64 {
		writeErr(w, 400, "invalid_id", "")
		return
	}
	var req coffreItemUpdateReq
	if err := jsonBody(r, &req); err != nil || len(req.Blob) == 0 || req.ExpectedVersion < 1 {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	if len(req.Blob) > coffreMaxBlob {
		writeErr(w, 413, "blob_too_large", "")
		return
	}
	item, err := a.store.UpdateCoffreItem(id, req.Blob, req.ExpectedVersion)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, 404, "not_found", "")
		return
	}
	if errors.Is(err, store.ErrConflict) {
		writeErr(w, 409, "version_conflict", "")
		return
	}
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditCoffreItemUpdate, "coffre/item/"+id, "")
	writeJSON(w, 200, item)
}

// coffreItemAction runs a single-item state change (soft delete,
// restore, purge) — same shape, same guards, different store call.
func (a *AdminServer) coffreItemAction(w http.ResponseWriter, r *http.Request, action string, run func(id string) error) {
	id := r.PathValue("id")
	if id == "" || len(id) > 64 {
		writeErr(w, 400, "invalid_id", "")
		return
	}
	err := run(id)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, 404, "not_found", "")
		return
	}
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", action, "coffre/item/"+id, "")
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// CoffreDeleteItem moves an item to the trash (recoverable).
func (a *AdminServer) CoffreDeleteItem(w http.ResponseWriter, r *http.Request) {
	a.coffreItemAction(w, r, model.AuditCoffreItemDelete, a.store.SoftDeleteCoffreItem)
}

// CoffreRestoreItem takes an item out of the trash.
func (a *AdminServer) CoffreRestoreItem(w http.ResponseWriter, r *http.Request) {
	a.coffreItemAction(w, r, model.AuditCoffreItemRestore, a.store.RestoreCoffreItem)
}

// CoffrePurgeItem hard-deletes one item (from the trash only).
func (a *AdminServer) CoffrePurgeItem(w http.ResponseWriter, r *http.Request) {
	a.coffreItemAction(w, r, model.AuditCoffreItemPurge, a.store.PurgeCoffreItem)
}

// CoffrePurgeTrash empties the trash (hard delete, count returned).
func (a *AdminServer) CoffrePurgeTrash(w http.ResponseWriter, _ *http.Request) {
	n, err := a.store.PurgeCoffreTrash()
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditCoffreTrashPurge, "coffre/trash", "")
	writeJSON(w, 200, map[string]int64{"purged": n})
}