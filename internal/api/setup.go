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
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

// SetupManager tracks setup state + the system info shown in the wizard.
type SetupManager struct {
	setupFlagPath string // data/setup_done
	dbPath        string
	listenAddr    string
	version       string
	initLimiter   *initLimiter
}

// NewSetupManager builds it from the config paths.
func NewSetupManager(dataDir, dbPath, listenAddr, version string) *SetupManager {
	return &SetupManager{
		setupFlagPath: filepath.Join(dataDir, "setup_done"),
		dbPath:        dbPath,
		listenAddr:    listenAddr,
		version:       version,
		initLimiter:   newInitLimiter(3), // public endpoint: hard cap
	}
}

// Reconcile runs at boot: a deployment is in wizard mode ONLY when the
// effective admin hash is still the public installer placeholder. Any
// instance with a real password (hash override file from a previous
// password change, or a custom KERVIA_VAULT_ADMIN_HASH) is marked done
// immediately — otherwise upgrading an existing vault would re-open the
// anonymous POST /setup/init window (takeover).
func (m *SetupManager) Reconcile(authSvc *auth.Service) {
	if m.Done() {
		return
	}
	if !authSvc.AdminPasswordIsPlaceholder() {
		m.markDone()
		slog.Warn("setup: marque fait automatiquement — un mot de passe admin existe déjà (upgrade)")
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
}

// Info returns the wizard-visible system state.
// Deliberately minimal: it is served PUBLICLY (the wizard needs it before
// any auth) — no db path, no server paths.
func (m *SetupManager) Info() SystemInfo {
	return SystemInfo{SetupDone: m.Done(), Listen: m.listenAddr, Version: m.version}
}

// Mount registers the setup endpoints (public, but only functional pre-setup).
func (m *SetupManager) Mount(mux *http.ServeMux, authSvc *auth.Service, st *store.Store) {
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
		// public endpoint on a fresh box: cap attempts even before a password exists
		if !m.initLimiter.allow(clientIP(r)) {
			writeErr(w, 429, "rate_limited", "trop de tentatives — réessaie plus tard")
			return
		}
		var req struct {
			AdminPassword string `json:"admin_password"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil || len(req.AdminPassword) < 12 {
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
		if st != nil {
			_ = st.AppendAuditDetail("system", "setup_init", "admin/password", "first boot setup completed",
				requestAuditInfo(r, 200))
		}
		writeJSON(w, 200, map[string]any{
			"status":         "initialized",
			"recovery_codes": codes,
		})
	})
}

// initLimiter caps /setup/init attempts per source IP. Minimal fixed window:
// the endpoint is anonymous pre-setup, so it needs its own guard.
type initLimiter struct {
	mu      sync.Mutex
	perHour int
	hits    map[string][]time.Time
}

func newInitLimiter(perHour int) *initLimiter {
	return &initLimiter{perHour: perHour, hits: map[string][]time.Time{}}
}

func (l *initLimiter) allow(source string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-time.Hour)
	recent := l.hits[source][:0]
	for _, t := range l.hits[source] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	if len(recent) >= l.perHour {
		l.hits[source] = recent
		return false
	}
	l.hits[source] = append(recent, now)
	// opportunistic cleanup: the map only ever holds attacker/new-install IPs
	if len(l.hits) > 10000 {
		for k, v := range l.hits {
			if len(v) == 0 {
				delete(l.hits, k)
			}
		}
	}
	return true
}

// requestAuditInfo describes a setup request for the append-only audit trail.
func requestAuditInfo(r *http.Request, status int) store.RequestInfo {
	return store.RequestInfo{
		Source: "webui", IP: clientIP(r), UserAgent: r.Header.Get("User-Agent"),
		Method: r.Method, Status: status, Path: "/setup/init",
	}
}
