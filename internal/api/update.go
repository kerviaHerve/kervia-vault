// Update endpoints (admin, session-guarded): see the current version, check
// for a newer release, apply it. The apply flow ends with os.Exit(0) so
// systemd Restart=on-failure brings the NEW binary up immediately.
//
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"net/http"
	"os"
	"time"

	"github.com/kerviaHerve/kervia-vault/internal/store"
	"github.com/kerviaHerve/kervia-vault/internal/update"
)

// UpdateServer wires the update manager to the admin surface.
type UpdateServer struct {
	mgr *update.Manager
	st  *store.Store
}

// NewUpdateServer builds it.
func NewUpdateServer(mgr *update.Manager, st *store.Store) *UpdateServer {
	return &UpdateServer{mgr: mgr, st: st}
}

// Mount registers the two endpoints (mounted inside the session-guarded
// admin mux — admin only, never public).
func (u *UpdateServer) Mount(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/update/status", func(w http.ResponseWriter, r *http.Request) {
		force := r.URL.Query().Get("force") == "1"
		writeJSON(w, 200, u.mgr.Check(force))
	})
	mux.HandleFunc("POST /admin/update/apply", func(w http.ResponseWriter, r *http.Request) {
		if u.mgr.Mode() == "docker" {
			writeErr(w, 409, "docker_readonly", "système de fichiers en lecture seule — mettez à jour via docker compose build/pull")
			return
		}
		newVersion, err := u.mgr.Apply()
		if err != nil {
			_ = u.st.AppendAuditDetail("admin", "update_failed", "binary", err.Error(),
				requestAuditInfo(r, 500))
			writeErr(w, 500, "update_failed", err.Error())
			return
		}
		_ = u.st.AppendAuditDetail("admin", "update_applied", "binary", u.mgr.Current()+" → "+newVersion,
			requestAuditInfo(r, 200))
		writeJSON(w, 200, map[string]any{
			"status": "restarting",
			"from":   u.mgr.Current(),
			"to":     newVersion,
			"note":   "le service redémarre sur le nouveau binaire — rechargez la page dans quelques secondes",
		})
		// flush the response BEFORE exiting — the browser must read it.
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		// exit(0) lets systemd Restart=always bring the NEW binary up.
		// Data is untouched: only the binary was swapped.
		go func() {
			time.Sleep(300 * time.Millisecond) // let the socket drain
			os.Exit(0)
		}()
	})
}
