// Audit middleware: records EVERY authenticated agent/webui API call with
// status, IP, user-agent. Detailed access log for agents and webui.
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"net/http"
	"strings"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/model"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

// clientIP extracts the source address (behind proxy: X-Real-IP first).
func clientIP(r *http.Request) string {
	if xrip := r.Header.Get("X-Real-IP"); xrip != "" {
		return xrip
	}
	if xfwd := r.Header.Get("X-Forwarded-For"); xfwd != "" {
		return strings.TrimSpace(strings.Split(xfwd, ",")[0])
	}
	if host := r.RemoteAddr; host != "" {
		if h, _, err := splitHost(host); err == nil {
			return h
		}
		return host
	}
	return "unknown"
}

func splitHost(hostPort string) (string, string, error) {
	i := strings.LastIndex(hostPort, ":")
	if i < 0 {
		return hostPort, "", nil
	}
	return hostPort[:i], hostPort[i+1:], nil
}

func ua(r *http.Request) string {
	if u := r.UserAgent(); len(u) > 200 {
		return u[:200]
	} else if u != "" {
		return u
	}
	return "unknown"
}

// AgentAudit wraps the agent API mux: after the handler runs, the call is
// audited with its outcome. The auth middleware has already resolved the agent.
func (s *Server) AgentAudit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rw := &auditWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(rw, r)
		agent, _ := auth.AgentFrom(r.Context())
		who := "unknown"
		if agent != nil {
			who = agent.ID
		}
		action := actionFromPath(r.Method, r.URL.Path, rw.status)
		_ = s.store.AppendAuditDetail(who, action, r.URL.Path, "",
			store.RequestInfo{
				Source: "agent", IP: clientIP(r), UserAgent: ua(r),
				Method: r.Method, Status: rw.status, Path: r.URL.Path,
			})
	})
}

// AdminAudit wraps the webui admin mux the same way.
func (a *AdminServer) AdminAudit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rw := &auditWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(rw, r)
		action := actionFromPath(r.Method, r.URL.Path, rw.status)
		_ = a.store.AppendAuditDetail("admin", action, r.URL.Path, "",
			store.RequestInfo{
				Source: "webui", IP: clientIP(r), UserAgent: ua(r),
				Method: r.Method, Status: rw.status, Path: r.URL.Path,
			})
	})
}

type auditWriter struct {
	http.ResponseWriter
	status int
}

func (w *auditWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// actionFromPath classifies the call for the audit trail.
func actionFromPath(method, path string, status int) string {
	if status == 401 || status == 403 {
		return model.AuditLoginFail // access denied — surfaced as denied
	}
	if status == 429 {
		return model.AuditRateLimited
	}
	switch {
	case strings.HasPrefix(path, "/admin/login"):
		return "login"
	case method == "POST" && strings.Contains(path, "revoke"):
		return model.AuditAgentRevoke
	case method == "POST" && strings.Contains(path, "grants"):
		return model.AuditGrant
	case method == "DELETE":
		return model.AuditGrantRevoke
	case method == "POST" && !strings.Contains(path, "secrets/"):
		return model.AuditCreate
	case method == "PATCH":
		return model.AuditUpdate
	case method == "DELETE " + path:
		return model.AuditDelete
	case strings.Contains(path, "delete"):
		return model.AuditDelete
	case method == "GET" && (strings.Contains(path, "secrets/") || strings.Contains(path, "reveal")):
		return model.AuditRead
	case strings.Contains(path, "templates"):
		return "list_templates"
	default:
		return "access"
	}
}