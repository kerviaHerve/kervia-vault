// 2FA (TOTP) endpoints. The STATUS is public — the login form needs to know
// whether to show a code field before any authentication happens; that
// reveals only "this instance uses 2FA", which the form would leak anyway.
// Everything else (state, enroll, confirm, disable) is session-guarded, and
// DISABLE requires both factors — an open session cannot silently strip the
// admin's second factor.
//
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"net/http"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/model"
)

// TOTPStatus PUBLIC : {"enabled": bool} — monté hors du middleware admin.
func TOTPStatus(authSvc *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]bool{"enabled": authSvc.TOTPRequired()})
	}
}

// TOTPStateHandler (session) : {"state": "none"|"pending"|"active"}.
func (a *AdminServer) TOTPStateHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]string{"state": a.authSvc.TOTPState()})
}

// TOTPEnrollHandler (session) : génère un seed PENDING, retourné UNE fois.
// Réponse : {"seed", "uri"} — le webui l'affiche pour l'import dans l'app
// TOTP (saisie manuelle ou copie de l'URI otpauth).
func (a *AdminServer) TOTPEnrollHandler(w http.ResponseWriter, _ *http.Request) {
	if a.authSvc.TOTPRequired() {
		writeErr(w, 409, "already_active", "désactive d'abord le 2FA (code requis)")
		return
	}
	seed, uri, err := a.authSvc.TOTPEnroll()
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.Audit2FAEnroll, "admin/2fa", "")
	writeJSON(w, 200, map[string]string{"seed": seed, "uri": uri})
}

// TOTPConfirmHandler (session) : {"code"} — prouve que le seed est bien dans
// l'app TOTP, active le second facteur.
func (a *AdminServer) TOTPConfirmHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
	}
	if err := jsonBody(r, &req); err != nil || req.Code == "" {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	if err := a.authSvc.TOTPConfirm(req.Code); err != nil {
		_ = a.store.AppendAudit("admin", model.AuditLoginFail, "admin/2fa/confirm", "")
		writeErr(w, 401, "invalid_code", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.Audit2FAEnable, "admin/2fa", "")
	writeJSON(w, 200, map[string]string{"status": "active"})
}

// TOTPDisableHandler (session) : {"password", "code"} — les DEUX facteurs
// exigés pour retirer le second facteur.
func (a *AdminServer) TOTPDisableHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if err := jsonBody(r, &req); err != nil || req.Password == "" || req.Code == "" {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	// échec uniforme, comme au login
	if !a.authSvc.CheckAdmin(req.Password) || !a.authSvc.TOTPDisable(req.Code) {
		_ = a.store.AppendAudit("admin", model.AuditLoginFail, "admin/2fa/disable", "")
		writeErr(w, 401, "invalid_credentials", "")
		return
	}
	_ = a.store.AppendAudit("admin", model.Audit2FADisable, "admin/2fa", "")
	writeJSON(w, 200, map[string]string{"status": "none"})
}