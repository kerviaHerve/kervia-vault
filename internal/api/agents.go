// Package api: REST handlers for the agent-scoped API (/v1/*).
// Every handler re-verifies the grant — defense in depth: even if a route
// is mismounted, an agent cannot escape its vaults.
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/model"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

// Server carries the dependencies of all handlers.
type Server struct {
	store *store.Store
	enc   *crypto.Encryptor
}

// New builds the API server.
func New(st *store.Store, enc *crypto.Encryptor) *Server {
	return &Server{store: st, enc: enc}
}

// ---- helpers ----

type apiError struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, apiError{Error: code, Message: msg})
}

func jsonBody(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20)) // 1 MiB max
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

// ---- agent endpoints ----

// Whoami returns the authenticated agent identity and its vaults.
func (s *Server) Whoami(w http.ResponseWriter, r *http.Request) {
	agent, _ := auth.AgentFrom(r.Context())
	vaults, err := s.store.ListVaultsForAgent(agent.ID)
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	writeJSON(w, 200, map[string]any{
		"id":     agent.ID,
		"name":   agent.Name,
		"vaults": vaults,
	})
}

// ListVaults returns the vaults the agent can access.
func (s *Server) ListVaults(w http.ResponseWriter, r *http.Request) {
	agent, _ := auth.AgentFrom(r.Context())
	vaults, err := s.store.ListVaultsForAgent(agent.ID)
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	writeJSON(w, 200, vaults)
}

// ListSecrets lists secret metadata (never values) for one vault.
func (s *Server) ListSecrets(w http.ResponseWriter, r *http.Request) {
	agent, _ := auth.AgentFrom(r.Context())
	vaultName := r.URL.Query().Get("vault")
	if vaultName == "" {
		writeErr(w, 400, "missing_vault", "query parameter 'vault' is required")
		return
	}
	vault, err := s.store.GetVaultByName(vaultName)
	if err != nil {
		writeErr(w, 404, "vault_not_found", "")
		return
	}
	ok, err := s.store.HasGrant(agent.ID, vault.ID, false)
	if err != nil || !ok {
		writeErr(w, 403, "forbidden", "")
		return
	}
	secrets, err := s.store.ListSecretsByVault(vault.ID)
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	writeJSON(w, 200, secrets)
}

// GetSecret returns one decrypted secret.
func (s *Server) GetSecret(w http.ResponseWriter, r *http.Request, id string) {
	agent, _ := auth.AgentFrom(r.Context())
	sec, nonce, ct, err := s.store.GetSecretByID(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "not_found", "")
			return
		}
		writeErr(w, 500, "internal", "")
		return
	}
	ok, err := s.store.HasGrant(agent.ID, sec.VaultID, false)
	if err != nil || !ok {
		_ = s.store.AppendAudit(agent.ID, model.AuditRead, "secret/"+id, "denied:no_grant")
		writeErr(w, 403, "forbidden", "")
		return
	}
	value, err := s.enc.Decrypt(nonce, ct)
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = s.store.AppendAudit(agent.ID, model.AuditRead, "secret/"+id, "")
	sec.Value = string(value)
	writeJSON(w, 200, sec)
}

type createSecretReq struct {
	Vault string `json:"vault"`
	Key   string `json:"key"`
	Value string `json:"value"`
}

// CreateSecret stores a new secret in a vault the agent can write.
func (s *Server) CreateSecret(w http.ResponseWriter, r *http.Request) {
	agent, _ := auth.AgentFrom(r.Context())
	var req createSecretReq
	if err := jsonBody(r, &req); err != nil || req.Vault == "" || req.Key == "" {
		writeErr(w, 400, "invalid_request", "fields vault, key, value are required")
		return
	}
	vault, err := s.store.GetVaultByName(req.Vault)
	if err != nil {
		writeErr(w, 404, "vault_not_found", "")
		return
	}
	ok, err := s.store.HasGrant(agent.ID, vault.ID, true)
	if err != nil || !ok {
		_ = s.store.AppendAudit(agent.ID, model.AuditCreate, "vault/"+vault.Name+"/secret/"+req.Key, "denied:no_grant")
		writeErr(w, 403, "forbidden", "")
		return
	}
	nonce, ct, err := s.enc.Encrypt([]byte(req.Value))
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	sec, err := s.store.CreateSecret(uuid.NewString(), vault.ID, req.Key, nonce, ct, uuid.NewString(), agent.ID)
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeErr(w, 409, "already_exists", "a secret with this key already exists in the vault")
			return
		}
		writeErr(w, 500, "internal", "")
		return
	}
	_ = s.store.AppendAudit(agent.ID, model.AuditCreate, "vault/"+vault.Name+"/secret/"+req.Key, "")
	writeJSON(w, 201, sec)
}

type updateSecretReq struct {
	Value string `json:"value"`
}

// UpdateSecret writes a new version of a secret.
func (s *Server) UpdateSecret(w http.ResponseWriter, r *http.Request, id string) {
	agent, _ := auth.AgentFrom(r.Context())
	var req updateSecretReq
	if err := jsonBody(r, &req); err != nil {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	sec, _, _, err := s.store.GetSecretByID(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "not_found", "")
			return
		}
		writeErr(w, 500, "internal", "")
		return
	}
	ok, err := s.store.HasGrant(agent.ID, sec.VaultID, true)
	if err != nil || !ok {
		_ = s.store.AppendAudit(agent.ID, model.AuditUpdate, "secret/"+id, "denied:no_grant")
		writeErr(w,  403, "forbidden", "")
		return
	}
	nonce, ct, err := s.enc.Encrypt([]byte(req.Value))
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	if err := s.store.UpdateSecretValue(id, nonce, ct, agent.ID, uuid.NewString()); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "not_found", "")
			return
		}
		writeErr(w, 500, "internal", "")
		return
	}
	_ = s.store.AppendAudit(agent.ID, model.AuditUpdate, "secret/"+id, "")
	writeJSON(w, 200, map[string]string{"status": "updated"})
}

// DeleteSecret soft-deletes a secret (audit keeps the trace).
func (s *Server) DeleteSecret(w http.ResponseWriter, r *http.Request, id string) {
	agent, _ := auth.AgentFrom(r.Context())
	sec, _, _, err := s.store.GetSecretByID(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "not_found", "")
			return
		}
		writeErr(w, 500, "internal", "")
		return
	}
	ok, err := s.store.HasGrant(agent.ID, sec.VaultID, true)
	if err != nil || !ok {
		_ = s.store.AppendAudit(agent.ID, model.AuditDelete, "secret/"+id, "denied:no_grant")
		writeErr(w, 403, "forbidden", "")
		return
	}
	if err := s.store.DeleteSecret(id); err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = s.store.AppendAudit(agent.ID, model.AuditDelete, "secret/"+id, "")
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}

// secretIDFromPath extracts the id from /v1/secrets/{id} paths.
// Strict: only [a-f0-9-] accepted (no traversal, no injection).
func secretIDFromPath(p string) (string, bool) {
	parts := strings.Split(strings.Trim(p, "/"), "/")
	if len(parts) != 3 || parts[0] != "v1" || parts[1] != "secrets" {
		return "", false
	}
	id := parts[2]
	if len(id) == 0 || len(id) > 64 {
		return "", false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'f' || c >= '0' && c <= '9' || c == '-') {
			return "", false
		}
	}
	return id, true
}