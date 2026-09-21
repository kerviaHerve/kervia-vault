// Admin handlers (webui backend): agents, vaults, grants, secrets, audit.
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/model"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

type AdminServer struct {
	store    *store.Store
	enc      *crypto.Encryptor
	authSvc  *auth.Service
}

// NewAdmin builds the admin API server.
func NewAdmin(st *store.Store, enc *crypto.Encryptor, authSvc *auth.Service) *AdminServer {
	return &AdminServer{store: st, enc: enc, authSvc: authSvc}
}

// Logout revokes the webui session (server-side + cookie).
func (a *AdminServer) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("av_session"); err == nil {
		a.authSvc.LogoutAdmin(c.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name: "av_session", Value: "", Path: "/",
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
		MaxAge: 0,
	})
	_ = a.store.AppendAuditDetail("admin", "logout", "admin/logout", "",
		store.RequestInfo{Source: "webui", IP: clientIP(r), UserAgent: ua(r), Method: r.Method, Status: 200, Path: "/admin/logout"})
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// Login handles POST /admin/login {password} → session cookie.
func (a *AdminServer) Login(w http.ResponseWriter, r *http.Request) {
	var req struct{ Password string `json:"password"` }
	if err := jsonBody(r, &req); err != nil || req.Password == "" {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	sid := a.authSvc.LoginAdmin(r, req.Password)
	if sid == "" {
		_ = a.store.AppendAudit("admin", model.AuditLoginFail, "admin/login", "")
		writeErr(w, 401, "invalid_credentials", "")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "av_session",
		Value:    sid,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   12 * 3600,
	})
	_ = a.store.AppendAudit("admin", "login", "admin/login", "")
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// CreateAgent creates an agent and returns the API key ONCE.
func (a *AdminServer) CreateAgent(w http.ResponseWriter, r *http.Request) {
	var req struct{ Name string `json:"name"` }
	if err := jsonBody(r, &req); err != nil || req.Name == "" || len(req.Name) > 64 {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	full, prefix, hash, err := crypto.GenerateAPIKey()
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	agent, err := a.store.CreateAgent(uuid.NewString(), req.Name, hash, prefix)
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeErr(w, 409, "name_taken", "")
			return
		}
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditAgentCreate, "agent/"+req.Name, "")
	// The key is returned exactly once and never stored in plaintext.
	writeJSON(w, 201, map[string]any{
		"agent": agent,
		"api_key": full,
		"warning": "store this key now — it will never be shown again",
	})
}

// ListAgents lists all agents (webui).
func (a *AdminServer) ListAgents(w http.ResponseWriter, _ *http.Request) {
	agents, err := a.store.ListAgents()
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	writeJSON(w, 200, agents)
}

// RevokeAgent disables an agent's key.
func (a *AdminServer) RevokeAgent(w http.ResponseWriter, r *http.Request, id string) {
	if err := a.store.RevokeAgent(id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "not_found", "")
			return
		}
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditAgentRevoke, "agent/"+id, "")
	writeJSON(w, 200, map[string]string{"status": "revoked"})
}

// CreateVault creates a vault.
func (a *AdminServer) CreateVault(w http.ResponseWriter, r *http.Request) {
	var req struct{ Name string `json:"name"` }
	if err := jsonBody(r, &req); err != nil || req.Name == "" || len(req.Name) > 64 {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	v, err := a.store.CreateVault(uuid.NewString(), req.Name)
	if err != nil {
		writeErr(w, 409, "name_taken", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditVaultCreate, "vault/"+req.Name, "")
	writeJSON(w, 201, v)
}

// ListVaults lists all vaults.
func (a *AdminServer) ListVaults(w http.ResponseWriter, _ *http.Request) {
	vaults, err := a.store.ListVaults()
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	writeJSON(w, 200, vaults)
}

// SetGrant adds or updates an agent↔vault grant.
func (a *AdminServer) SetGrant(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AgentID  string `json:"agent_id"`
		VaultID  string `json:"vault_id"`
		CanWrite bool   `json:"can_write"`
	}
	if err := jsonBody(r, &req); err != nil || req.AgentID == "" || req.VaultID == "" {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	if err := a.store.AddGrant(req.AgentID, req.VaultID, req.CanWrite); err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditGrant, "agent/"+req.AgentID+"/vault/"+req.VaultID,
		"can_write="+strconv.FormatBool(req.CanWrite))
	writeJSON(w, 200, map[string]string{"status": "granted"})
}

// RemoveGrant removes a grant.
func (a *AdminServer) RemoveGrant(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AgentID string `json:"agent_id"`
		VaultID string `json:"vault_id"`
	}
	if err := jsonBody(r, &req); err != nil || req.AgentID == "" || req.VaultID == "" {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	if err := a.store.RemoveGrant(req.AgentID, req.VaultID); err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditGrantRevoke, "agent/"+req.AgentID+"/vault/"+req.VaultID, "")
	writeJSON(w, 200, map[string]string{"status": "revoked"})
}

// ListGrants returns the full grant matrix.
func (a *AdminServer) ListGrants(w http.ResponseWriter, _ *http.Request) {
	grants, err := a.store.ListGrants()
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	writeJSON(w, 200, grants)
}

// AdminCreateSecret creates a secret from the webui (values visible there).
func (a *AdminServer) CreateSecret(w http.ResponseWriter, r *http.Request) {
	var req createSecretReq
	if err := jsonBody(r, &req); err != nil || req.Vault == "" || req.Key == "" {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	vault, err := a.store.GetVaultByName(req.Vault)
	if err != nil {
		writeErr(w, 404, "vault_not_found", "")
		return
	}
	payload, templateKey, verr := resolveSecretPayload(req)
	if verr != "" {
		writeErr(w, 400, "invalid_template", verr)
		return
	}
	nonce, ct, err := a.enc.Encrypt(payload)
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	sec, err := a.store.CreateSecret(uuid.NewString(), vault.ID, req.Key, templateKey, nonce, ct, uuid.NewString(), "admin")
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeErr(w, 409, "already_exists", "")
			return
		}
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.AuditCreate, "vault/"+req.Vault+"/secret/"+req.Key, "")
	writeJSON(w, 201, sec)
}

// AdminListSecrets lists a vault's secrets WITH decrypted values (webui view).
func (a *AdminServer) ListSecrets(w http.ResponseWriter, r *http.Request) {
	vaultName := r.URL.Query().Get("vault")
	if vaultName == "" {
		writeErr(w, 400, "missing_vault", "")
		return
	}
	vault, err := a.store.GetVaultByName(vaultName)
	if err != nil {
		writeErr(w, 404, "vault_not_found", "")
		return
	}
	secrets, err := a.store.ListSecretsByVault(vault.ID)
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	// decrypt values for the webui
	type secretWithSecretValue struct {
		model.Secret
		Value string `json:"value"`
	}
	out := make([]secretWithSecretValue, 0, len(secrets))
	for _, sec := range secrets {
		_, nonce, ct, err := a.store.GetSecretByID(sec.ID)
		if err != nil {
			continue
		}
		val, err := a.enc.Decrypt(nonce, ct)
		if err != nil {
			continue
		}
		out = append(out, secretWithSecretValue{Secret: *sec, Value: string(val)})
	}
	_ = a.store.AppendAudit("admin", model.AuditRead, "vault/"+vaultName, "")
	writeJSON(w, 200, out)
}

// Audit lists the audit trail.
func (a *AdminServer) Audit(w http.ResponseWriter, r *http.Request) {
	limit := intQuery(r, "limit", 100)
	offset := intQuery(r, "offset", 0)
	agent := r.URL.Query().Get("agent")
	entries, err := a.store.ListAudit(limit, offset, agent)
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	writeJSON(w, 200, entries)
}

// Versions lists the version history of a secret.
func (a *AdminServer) Versions(w http.ResponseWriter, r *http.Request, id string) {
	versions, err := a.store.ListVersions(id)
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	writeJSON(w, 200, versions)
}

func intQuery(r *http.Request, name string, def int) int {
	v := r.URL.Query().Get(name)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 || n > 1000 {
		return def
	}
	return n
}

var _ = json.Marshal // keep json imported (used via writeJSON)
var _ = bcrypt.MinCost
type changePasswordReq struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// ChangePassword updates the admin bcrypt hash (persisted to a settings file
// next to the DB — the env var stays the boot default).
func (a *AdminServer) ChangePassword(w http.ResponseWriter, r *http.Request) {
	var req changePasswordReq
	if err := jsonBody(r, &req); err != nil || req.CurrentPassword == "" || req.NewPassword == "" {
		writeErr(w, 400, "invalid_request", "current_password and new_password are required")
		return
	}
	if len(req.NewPassword) < 12 {
		writeErr(w, 400, "too_short", "le mot de passe doit faire au moins 12 caractères")
		return
	}
	if !a.authSvc.CheckAdmin(req.CurrentPassword) {
		_ = a.store.AppendAuditDetail("admin", model.AuditLoginFail, "admin/password-change", "bad current password",
			store.RequestInfo{Source: "webui", IP: clientIP(r), UserAgent: ua(r), Method: r.Method, Status: 401, Path: "/admin/password"})
		writeErr(w, 401, "invalid_credentials", "mot de passe actuel incorrect")
		return
	}
	if err := a.authSvc.SetAdminPassword(req.NewPassword); err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAuditDetail("admin", "password_change", "admin/password", "",
		store.RequestInfo{Source: "webui", IP: clientIP(r), UserAgent: ua(r), Method: r.Method, Status: 200, Path: "/admin/password"})
	writeJSON(w, 200, map[string]string{"status": "updated"})
}

// ---- pro management endpoints ----

// DeleteVault removes an EMPTY vault (grants cascade).
func (a *AdminServer) DeleteVault(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" || len(id) > 64 {
		writeErr(w, 400, "invalid_id", "")
		return
	}
	if err := a.store.DeleteVault(id); err != nil {
		if err.Error() == "vault_not_empty" {
			n, _ := a.store.CountSecretsByVault(id)
			writeErr(w, 409, "vault_not_empty", "supprimez d'abord les secrets de ce vault")
			_ = a.store.AppendAuditDetail("admin", "vault_delete_denied", "vault/"+id,
				"not_empty:"+strconv.Itoa(n), store.RequestInfo{Source: "webui", IP: clientIP(r), UserAgent: ua(r), Method: r.Method, Status: 409, Path: r.URL.Path})
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "not_found", "")
			return
		}
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAuditDetail("admin", "vault_delete", "vault/"+id, "",
		store.RequestInfo{Source: "webui", IP: clientIP(r), UserAgent: ua(r), Method: r.Method, Status: 200, Path: r.URL.Path})
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}

// PurgeAgent hard-deletes a REVOKED agent (grants cascade).
func (a *AdminServer) PurgeAgent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" || len(id) > 64 {
		writeErr(w, 400, "invalid_id", "")
		return
	}
	if err := a.store.PurgeAgent(id); err != nil {
		if err.Error() == "agent_not_revoked" {
			writeErr(w, 409, "not_revoked", "révoquez d'abord l'agent")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "not_found", "")
			return
		}
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAuditDetail("admin", "agent_purge", "agent/"+id, "",
		store.RequestInfo{Source: "webui", IP: clientIP(r), UserAgent: ua(r), Method: r.Method, Status: 200, Path: r.URL.Path})
	writeJSON(w, 200, map[string]string{"status": "purged"})
}

// UpdateSecret edits a secret: rename the key and/or update the value
// (value update = new version, history preserved).
func (a *AdminServer) UpdateSecret(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" || len(id) > 64 {
		writeErr(w, 400, "invalid_id", "")
		return
	}
	var req struct {
		Key   string `json:"key,omitempty"`
		Value string `json:"value,omitempty"`
	}
	if err := jsonBody(r, &req); err != nil || (req.Key == "" && req.Value == "") {
		writeErr(w, 400, "invalid_request", "key and/or value required")
		return
	}
	// rename
	if req.Key != "" {
		if err := a.store.UpdateSecretKey(id, req.Key); err != nil {
			if errors.Is(err, store.ErrConflict) {
				writeErr(w, 409, "already_exists", "ce nom existe déjà dans le vault")
				return
			}
			if errors.Is(err, store.ErrNotFound) {
				writeErr(w, 404, "not_found", "")
				return
			}
			writeErr(w, 500, "internal", "")
			return
		}
	}
	// value → new version
	if req.Value != "" {
		nonce, ct, err := a.enc.Encrypt([]byte(req.Value))
		if err != nil {
			writeErr(w, 500, "internal", "")
			return
		}
		if err := a.store.UpdateSecretValue(id, nonce, ct, "admin", uuid.NewString()); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeErr(w, 404, "not_found", "")
				return
			}
			writeErr(w, 500, "internal", "")
			return
		}
	}
	_ = a.store.AppendAuditDetail("admin", model.AuditUpdate, "secret/"+id, "",
		store.RequestInfo{Source: "webui", IP: clientIP(r), UserAgent: ua(r), Method: r.Method, Status: 200, Path: r.URL.Path})
	writeJSON(w, 200, map[string]string{"status": "updated"})
}

// DeleteVaultByGrantAdmin removes a grant (dedicated to the vault detail view).
func (a *AdminServer) RevokeGrant(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AgentID string `json:"agent_id"`
		VaultID string `json:"vault_id"`
	}
	if err := jsonBody(r, &req); err != nil || req.AgentID == "" || req.VaultID == "" {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	if err := a.store.RemoveGrant(req.AgentID, req.VaultID); err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAuditDetail("admin", model.AuditGrantRevoke,
		"agent/"+req.AgentID+"/vault/"+req.VaultID, "",
		store.RequestInfo{Source: "webui", IP: clientIP(r), UserAgent: ua(r), Method: r.Method, Status: 200, Path: r.URL.Path})
	writeJSON(w, 200, map[string]string{"status": "revoked"})
}
