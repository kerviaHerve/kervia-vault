// Setup wizard: first-boot configuration via the webui.
// When data/setup_done is absent, the server runs in SETUP mode:
//   - POST /setup/init is PUBLIC (creates the admin password)
//   - all /admin/* and /v1/* endpoints stay guarded (no session exists yet,
//     so nothing is reachable anyway — the wizard logs in after init)
// After init, setup_done is written and the endpoint 410s Gone.
//
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
)

// SetupManager tracks setup state + the system info shown in the wizard.
type SetupManager struct {
	setupFlagPath string // data/setup_done
	dbPath        string
	listenAddr    string
	version       string
}

// NewSetupManager builds it from the config paths.
func NewSetupManager(dataDir, dbPath, listenAddr string) *SetupManager {
	return &SetupManager{
		setupFlagPath: filepath.Join(dataDir, "setup_done"),
		dbPath:        dbPath,
		listenAddr:    listenAddr,
		version:       "1.0",
	}
}

// Done reports whether setup already ran.
func (m *SetupManager) Done() bool {
	_, err := os.Stat(m.setupFlagPath)
	return err == nil
}

// markDone writes the flag (irreversible from the API).
func (m *SetupManager) markDone() {
	_ = os.WriteFile(m.setupFlagPath, []byte("done"), 0o600)
}

// SystemInfo is shown by the wizard + install script.
type SystemInfo struct {
	SetupDone bool   `json:"setup_done"`
	Listen    string `json:"listen"`
	Version   string `json:"version"`
	DBPath    string `json:"db_path"`
}

// Info returns the wizard-visible system state.
func (m *SetupManager) Info() SystemInfo {
	return SystemInfo{SetupDone: m.Done(), Listen: m.listenAddr, Version: m.version, DBPath: m.dbPath}
}

// Mount registers the setup endpoints (public, but only functional pre-setup).
func (m *SetupManager) Mount(mux *http.ServeMux, authSvc *auth.Service) {
	// public: wizard reads this to know which step to show
	mux.HandleFunc("GET /setup/info", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(m.Info())
	})

	// public ONLY when setup hasn't run; after that → 410 Gone
	mux.HandleFunc("POST /setup/init", func(w http.ResponseWriter, r *http.Request) {
		if m.Done() {
			writeErr(w, 410, "setup_done", "l'installation est déjà terminée")
			return
		}
		var req struct {
			AdminPassword string `json:"admin_password"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<16)).Decode(&req); err != nil || len(req.AdminPassword) < 12 {
			writeErr(w, 400, "invalid_request", "12 caractères minimum")
			return
		}
		if err := authSvc.SetAdminPassword(req.AdminPassword); err != nil {
			writeErr(w, 500, "internal", "")
			return
		}
		// recovery codes already exist (first-boot Ensure); regenerate fresh ones
		// so they're created AFTER the user chose their password
		codes := authSvc.RegenerateRecoveryCodesUnauthenticated()
		m.markDone()
		writeJSON(w, 200, map[string]any{
			"status": "initialized",
			"recovery_codes": codes,
		})
	})
}