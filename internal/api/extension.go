// Extension API: the browser-extension token and the /ext/coffre
// read surface.
//
// SECURITY MODEL (v1.8.0) — the token grants ONE thing: reading the
// E2E-encrypted coffre blobs (envelope + items). It is NOT an admin
// credential (no /admin surface), NOT an agent key (no /v1, no MCP —
// the coffre tripwire stays intact). The blobs are worthless without
// the master password: zero-knowledge is preserved end to end.
//
//   webui Paramètres  ──crée──▶  hash Argon2id en base
//   extension options ──colle──▶ token en clair (storage.local du
//                                 navigateur, pas de cookie, pas de disque serveur)
//   extension         ──GET /ext/coffre avec Authorization: Bearer ──▶ blobs
//
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/model"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

// ExtensionTokenPrefix marks the token visually (like av_ for agents).
const ExtensionTokenPrefix = "kvext_"

// newExtensionToken generates the plaintext token: kvext_<64 hex>.
func newExtensionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return ExtensionTokenPrefix + hex.EncodeToString(b), nil
}

// ExtensionTokenCreate handles POST /admin/extension/token.
// Generates a fresh token (revoking the previous one) and returns the
// plaintext ONCE — the server only ever stores its Argon2id hash.
func (a *AdminServer) ExtensionTokenCreate(w http.ResponseWriter, r *http.Request) {
	tok, err := newExtensionToken()
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	if err := a.store.SetExtensionToken(crypto.HashAPIKey(tok)); err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditExtensionTokenCreate, "extension/token", "")
	writeJSON(w, 201, map[string]string{"token": tok})
}

// ExtensionTokenStatus handles GET /admin/extension/token.
// Never returns the token or its hash — existence + timestamps only.
func (a *AdminServer) ExtensionTokenStatus(w http.ResponseWriter, _ *http.Request) {
	t, err := a.store.GetExtensionToken()
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, 200, map[string]any{"present": false})
		return
	}
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	writeJSON(w, 200, map[string]any{
		"present":      true,
		"created_at":   t.CreatedAt,
		"last_used_at": t.LastUsedAt,
	})
}

// ExtensionTokenRevoke handles DELETE /admin/extension/token.
func (a *AdminServer) ExtensionTokenRevoke(w http.ResponseWriter, _ *http.Request) {
	if err := a.store.RevokeExtensionToken(); err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditExtensionTokenRevoke, "extension/token", "")
	writeJSON(w, 200, map[string]string{"status": "revoked"})
}

// ExtensionCoffre handles GET /ext/coffre — THE extension surface.
// Bearer token → envelope + every opaque blob in one round trip.
// Same zero-knowledge invariants as the admin coffre routes: the
// handler cannot decrypt, log or reveal anything; audit carries
// opaque IDs only.
func (s *Server) ExtensionCoffre(w http.ResponseWriter, r *http.Request) {
	tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !strings.HasPrefix(tok, ExtensionTokenPrefix) || len(tok) != len(ExtensionTokenPrefix)+64 {
		writeErr(w, 401, "invalid_token", "")
		return
	}
	stored, err := s.store.GetExtensionToken()
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, 401, "invalid_token", "")
		return
	}
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	if !crypto.VerifyAPIKey(tok, stored.TokenHash) {
		writeErr(w, 401, "invalid_token", "")
		return
	}
	meta, err := s.store.GetCoffreMeta()
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, 404, "coffre_not_created", "")
		return
	}
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	items, err := s.store.ListCoffreItems()
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	s.store.TouchExtensionToken() // best-effort — jamais bloquant
	writeJSON(w, 200, map[string]any{
		"envelope": map[string]any{
			"kdf_algo":        meta.KDFAlgo,
			"kdf_params":      meta.KDFParams,
			"kdf_salt_b64":     meta.KDFSalt,
			"wrapped_key_b64":  meta.WrappedKey,
			"verifier_b64":     meta.Verifier,
			"created_at":        meta.CreatedAt.Format(time.RFC3339Nano),
			"updated_at":        meta.UpdatedAt.Format(time.RFC3339Nano),
		},
		"items": items,
	})
}