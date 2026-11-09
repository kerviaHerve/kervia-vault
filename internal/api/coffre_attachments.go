// Coffre attachments API (v1.9.0) — sealed files bound to a coffre item.
//
// Zero-knowledge, like everything coffre: the request carries two opaque
// AES-256-GCM blobs (meta + data) sealed in the browser with the coffre
// key. This handler cannot decrypt, log or reveal anything — audit carries
// opaque ids only. Quotas enforced HERE (the browser pre-checks, the server
// is the authority): 2 MiB of raw data per file, 5 attachments per item.
//
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"encoding/base64"
	"net/http"

	"github.com/google/uuid"

	"github.com/kerviaHerve/kervia-vault/internal/model"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

const (
	coffreAttachMaxRaw       = 2 << 20 // 2 MiB de contenu décodé par fichier
	coffreAttachMaxPerItem   = 5       // pièces jointes par item
	coffreAttachMaxBody      = 12 << 20
	coffreTrashRetentionDays = 30 // v1.9.0 : purge paresseuse de la corbeille
)

type coffreAttachReq struct {
	MetaB64 string `json:"meta_b64"`
	DataB64 string `json:"data_b64"`
}

// CoffreAddAttachment (admin) : POST /admin/coffre/items/{id}/attachments.
func (a *AdminServer) CoffreAddAttachment(w http.ResponseWriter, r *http.Request) {
	itemID := r.PathValue("id")
	var req coffreAttachReq
	if err := jsonBodyN(r, &req, coffreAttachMaxBody); err != nil || itemID == "" {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	meta, err1 := base64.StdEncoding.DecodeString(req.MetaB64)
	data, err2 := base64.StdEncoding.DecodeString(req.DataB64)
	if err1 != nil || err2 != nil || len(meta) == 0 || len(data) == 0 {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	if len(data) > coffreAttachMaxRaw {
		writeErr(w, 400, "attach_too_big", "")
		return
	}
	n, err := a.store.CountCoffreAttachments(itemID)
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	if n >= coffreAttachMaxPerItem {
		writeErr(w, 400, "attach_too_many", "")
		return
	}
	id := uuid.NewString()
	if err := a.store.CreateCoffreAttachment(id, itemID, meta, data); err != nil {
		if err == store.ErrNotFound {
			// l'item parent n'existe pas (ou est purgé) : la pièce jointe
			// n'a rien à rattacher
			writeErr(w, 404, "item_not_found", "")
			return
		}
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditCoffreAttachAdd, "coffre/attachment/"+id, "")
	writeJSON(w, 201, map[string]any{"id": id})
}

// CoffreListAttachments (admin) : GET /admin/coffre/items/{id}/attachments —
// métadonnées + petit blob meta scellé, JAMAIS le contenu (le client le
// déchiffre pour afficher le nom ; le contenu ne voyage qu'au téléchargement).
func (a *AdminServer) CoffreListAttachments(w http.ResponseWriter, r *http.Request) {
	itemID := r.PathValue("id")
	list, err := a.store.ListCoffreAttachments(itemID)
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	writeJSON(w, 200, list)
}

// CoffreGetAttachment (admin) : GET /admin/coffre/attachments/{aid} — les
// deux blobs dans leur intégralité (téléchargement → déchiffrement local).
func (a *AdminServer) CoffreGetAttachment(w http.ResponseWriter, r *http.Request) {
	att, err := a.store.GetCoffreAttachment(r.PathValue("aid"))
	if err != nil {
		writeErr(w, 404, "attach_not_found", "")
		return
	}
	writeJSON(w, 200, att)
}

// CoffreDeleteAttachment (admin) : DELETE /admin/coffre/attachments/{aid} —
// idempotent (répond ok même si déjà supprimée : un double-clic n'échoue jamais).
func (a *AdminServer) CoffreDeleteAttachment(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("aid")
	if id == "" {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	if err := a.store.DeleteCoffreAttachment(id); err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditCoffreAttachDelete, "coffre/attachment/"+id, "")
	writeJSON(w, 200, map[string]any{"deleted": true})
}
