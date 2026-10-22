// Router: mounts every route with its middleware chain.
// Go 1.22+ pattern routing — no framework, stdlib only.
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
)

// Router builds the complete http.Handler.
// adminExtender (optional) receives the guarded admin mux so extra
// admin endpoints can be attached (webui reveal/delete).
func (s *Server) Router(authSvc *auth.Service, admin *AdminServer, adminExtender func(*http.ServeMux)) http.Handler {
	mux := http.NewServeMux()

	// ---- agent API (API key auth) ----
	agentMux := http.NewServeMux()
	agentMux.HandleFunc("GET /v1/whoami", s.Whoami)
	agentMux.HandleFunc("GET /v1/vaults", s.ListVaults)
	agentMux.HandleFunc("GET /v1/secrets", s.ListSecrets)
	agentMux.HandleFunc("POST /v1/secrets", s.CreateSecret)
	agentMux.HandleFunc("GET /v1/templates", s.ListTemplates)
	agentMux.HandleFunc("GET /v1/templates/{key}", s.GetTemplate)
	agentMux.HandleFunc("GET /v1/secrets/{id}", s.getSecretHandler)
	agentMux.HandleFunc("PATCH /v1/secrets/{id}", s.updateSecretHandler)
	agentMux.HandleFunc("DELETE /v1/secrets/{id}", s.deleteSecretHandler)

	mux.Handle("/v1/", authSvc.Authenticate(s.AgentAudit(agentMux)))

	// ---- admin API (session auth, except /admin/login) ----
	adminMux := http.NewServeMux()
	adminMux.HandleFunc("POST /admin/agents", admin.CreateAgent)
	adminMux.HandleFunc("GET /admin/agents", admin.ListAgents)
	adminMux.HandleFunc("POST /admin/agents/{id}/revoke", admin.revokeAgentHandler)
	adminMux.HandleFunc("POST /admin/vaults", admin.CreateVault)
	adminMux.HandleFunc("GET /admin/vaults", admin.ListVaults)
	adminMux.HandleFunc("POST /admin/grants", admin.SetGrant)
	adminMux.HandleFunc("DELETE /admin/grants", admin.RemoveGrant)
	adminMux.HandleFunc("GET /admin/grants", admin.ListGrants)
	adminMux.HandleFunc("POST /admin/secrets", admin.CreateSecret)
	adminMux.HandleFunc("GET /admin/secrets", admin.ListSecrets)
	adminMux.HandleFunc("GET /admin/audit", admin.Audit)
	adminMux.HandleFunc("DELETE /admin/vaults/{id}", admin.DeleteVault)
	adminMux.HandleFunc("DELETE /admin/agents/{id}", admin.PurgeAgent)
	adminMux.HandleFunc("PATCH /admin/secrets/{id}", admin.UpdateSecret)
	adminMux.HandleFunc("GET /admin/versions/{id}", admin.versionsHandler)

	// ---- coffre: personal password manager (session-guarded ONLY —
	// zero agent surface: nothing under /v1, nothing under /mcp; the
	// data is end-to-end encrypted in the browser) ----
	adminMux.HandleFunc("GET /admin/coffre", admin.CoffreHeader)
	adminMux.HandleFunc("POST /admin/coffre", admin.CoffreCreate)
	adminMux.HandleFunc("POST /admin/coffre/rekey", admin.CoffreRekey)
	adminMux.HandleFunc("DELETE /admin/coffre", admin.CoffreDestroy)
	adminMux.HandleFunc("GET /admin/coffre/items", admin.CoffreListItems)
	adminMux.HandleFunc("POST /admin/coffre/items", admin.CoffreCreateItem)
	adminMux.HandleFunc("POST /admin/coffre/items/batch", admin.CoffreImportItems)
	adminMux.HandleFunc("PATCH /admin/coffre/items/{id}", admin.CoffreUpdateItem)
	adminMux.HandleFunc("DELETE /admin/coffre/items/{id}", admin.CoffreDeleteItem)
	adminMux.HandleFunc("POST /admin/coffre/items/{id}/restore", admin.CoffreRestoreItem)
	adminMux.HandleFunc("POST /admin/coffre/items/{id}/purge", admin.CoffrePurgeItem)
	adminMux.HandleFunc("POST /admin/coffre/trash/purge", admin.CoffrePurgeTrash)

	// ---- 2FA (TOTP) : gestion session-guardée ; le status public est
	// monté plus bas sur le mux racine (le formulaire de login en a besoin
	// AVANT authentification) ----
	adminMux.HandleFunc("GET /admin/2fa/state", admin.TOTPStateHandler)
	adminMux.HandleFunc("POST /admin/2fa/enroll", admin.TOTPEnrollHandler)
	adminMux.HandleFunc("POST /admin/2fa/confirm", admin.TOTPConfirmHandler)
	adminMux.HandleFunc("POST /admin/2fa/disable", admin.TOTPDisableHandler)

	// ---- liens de partage éphémères (one-time) : création session-guardée ;
	// la vue publique est montée sur le mux racine ci-dessous ----
	adminMux.HandleFunc("POST /admin/secrets/{id}/share", admin.ShareSecret)

	// ---- export DR chiffré (bundle KVX1 passphrase-scellé) ----
	adminMux.HandleFunc("POST /admin/export", admin.ExportHandler)
	// ---- restore webui du bundle DR : dry-run (vérifier) puis import des
	// vaults MANQUANTS uniquement — jamais d'écrasement ----
	adminMux.HandleFunc("POST /admin/restore", admin.RestoreHandler)

	// ---- token d'extension navigateur : création/statut/révocation
	// session-guardées (v1.8.0) — le token en clair n'est JAMAIS stocké ----
	adminMux.HandleFunc("POST /admin/extension/token", admin.ExtensionTokenCreate)
	adminMux.HandleFunc("GET /admin/extension/token", admin.ExtensionTokenStatus)
	adminMux.HandleFunc("DELETE /admin/extension/token", admin.ExtensionTokenRevoke)

	if adminExtender != nil {
		adminExtender(adminMux)
	}
	mux.Handle("/admin/", authSvc.AdminMiddleware(admin.AdminAudit(adminMux)))
	mux.Handle("POST /admin/login", admin.AdminAudit(http.HandlerFunc(admin.Login)))
	mux.Handle("POST /admin/logout", http.HandlerFunc(admin.Logout))
	// public : le login form doit savoir s'il faut un champ code — révèle
	// seulement « cette instance utilise le 2FA », pas un secret.
	mux.HandleFunc("GET /totp/status", TOTPStatus(authSvc))
	// public : la page de partage — autonome, sans JS, jetable
	mux.HandleFunc("GET /share/", admin.ViewShare)
	// extension navigateur : LA seule surface /ext/* — lecture des blobs
	// chiffrés du coffre (Bearer token, hash Argon2id en base). Pas de
	// surface admin, pas de /v1, pas de MCP — invariants coffre intacts.
	mux.HandleFunc("GET /ext/coffre", s.ExtensionCoffre)
	mux.HandleFunc("POST /recovery/recover", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Code        string `json:"code"`
			NewPassword string `json:"new_password"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<16)).Decode(&req); err != nil {
			writeErr(w, 400, "invalid_request", "")
			return
		}
		if !authSvc.RecoverWithCode(req.Code, req.NewPassword) {
			_ = authSvc.AuditRecoveryFail(r)
			writeErr(w, 401, "invalid_code", "")
			return
		}
		_ = authSvc.AuditRecoverySuccess(r)
		writeJSON(w, 200, map[string]string{"status": "recovered"})
	})

	return logRequests(mux)
}

// {id} path value adapters (clean handlers keep the ctx signature).
func (s *Server) getSecretHandler(w http.ResponseWriter, r *http.Request) {
	id, ok := secretIDFromPath(r.URL.Path)
	if !ok {
		writeErr(w, 400, "invalid_id", "")
		return
	}
	s.GetSecret(w, r, id)
}

func (s *Server) updateSecretHandler(w http.ResponseWriter, r *http.Request) {
	id, ok := secretIDFromPath(r.URL.Path)
	if !ok {
		writeErr(w, 400, "invalid_id", "")
		return
	}
	s.UpdateSecret(w, r, id)
}

func (s *Server) deleteSecretHandler(w http.ResponseWriter, r *http.Request) {
	id, ok := secretIDFromPath(r.URL.Path)
	if !ok {
		writeErr(w, 400, "invalid_id", "")
		return
	}
	s.DeleteSecret(w, r, id)
}

func (a *AdminServer) revokeAgentHandler(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" || len(id) > 64 {
		writeErr(w, 400, "invalid_id", "")
		return
	}
	a.RevokeAgent(w, r, id)
}

func (a *AdminServer) versionsHandler(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" || len(id) > 64 {
		writeErr(w, 400, "invalid_id", "")
		return
	}
	a.Versions(w, r, id)
}

// logRequests: slog access log. Never logs bodies — bodies carry secrets.
func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(rw, r)
		slog.Info("http",
			"method", r.Method,
			// path only — query may carry identifiers, values never.
			// Et /share/<token> : le token EST la credential (audit 1.5.0) —
			// jamais un token de partage dans les logs.
			"path", logSafePath(r.URL.Path),
			"status", rw.status,
			"ms", time.Since(start).Milliseconds(),
		)
	})
}

// logSafePath masque les segments porteurs de credentials. Un token de
// partage vivant dans les logs offrirait au lecteur des logs une fenêtre
// de vol avant la première consultation légitime.
func logSafePath(p string) string {
	if strings.HasPrefix(p, "/share/") && len(p) > len("/share/") {
		return "/share/[redacted]"
	}
	return p
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}