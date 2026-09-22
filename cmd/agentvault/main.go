// Kervia-vault entrypoint: config → store → crypto → API → serve.
// SPDX-License-Identifier: AGPL-3.0

// Package main is the Kervia-vault server binary.
package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/kerviaHerve/kervia-vault/internal/api"
	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/config"
	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	agmcp "github.com/kerviaHerve/kervia-vault/internal/mcp"
	"github.com/kerviaHerve/kervia-vault/internal/store"
	agweb "github.com/kerviaHerve/kervia-vault/internal/web"
	"golang.org/x/crypto/bcrypt"
)

// version is set at build time (-ldflags "-X main.version=v1.0.0"),
// e.g. by the Dockerfile or the release workflow.
var version = "dev"

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--mcp-stdio":
			runMCPStdio()
			return
		case "hashpw":
			// helper: bcrypt a password from stdin/argv for KERVIA_VAULT_ADMIN_HASH
			runHashPw(os.Args[2:])
			return
		}
	}

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))

	cfg, err := config.FromEnv()
	if err != nil {
		slog.Error("startup refused", "reason", err)
		os.Exit(1) // fail-closed
	}

	// ensure the DB directory exists
	if dir := filepathOf(cfg.DBPath); dir != "" {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			slog.Error("db dir", "err", err)
			os.Exit(1)
		}
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		slog.Error("store", "err", err)
		os.Exit(1)
	}
	defer func() { _ = st.Close() }()

	enc, err := crypto.NewEncryptorFromHex(cfg.MasterKey)
	if err != nil {
		slog.Error("crypto", "err", err)
		os.Exit(1)
	}

	authSvc := auth.New(st, cfg.AdminHash, cfg.RatePerMin)
	// admin password changes persist next to the DB (override at boot)
	authSvc.SetHashPath(filepathOf(cfg.DBPath) + "/admin_hash")
	authSvc.LoadAdminHashOverride()
	// audit retention: 90 days, daily cleanup
	retentionStop := st.StartRetention(90)
	defer func() { close(retentionStop) }()
	apiServer := api.New(st, enc)
	adminServer := api.NewAdmin(st, enc, authSvc)

	webSrv := agweb.New(st, authSvc, enc)
	// setup wizard manager (first-boot /setup/init is public pre-flag)
	dataDir := filepathOf(cfg.DBPath)
	setupMgr := api.NewSetupManager(dataDir, cfg.DBPath, cfg.ListenAddr, version)
	// Reconcile AFTER LoadAdminHashOverride: an instance that already has a
	// real admin password (hash override or custom env hash) is NEVER
	// re-opened in wizard mode — otherwise an upgrade would re-expose the
	// anonymous /setup/init window.
	setupMgr.Reconcile(authSvc)
	if setupMgr.Done() {
		slog.Info("setup: déjà effectué (data/setup_done)")
	} else {
		slog.Warn("setup: PREMIER BOOT — wizard accessible via le webui")
	}

	// recovery codes: first-boot generation (if none) + persistence paths
	authSvc.SetRecoveryPath(filepathOf(cfg.DBPath) + "/recovery_codes")
	authSvc.LoadRecoveryCodes()
	if plain := authSvc.EnsureRecoveryCodes(); plain != nil {
		slog.Warn("RECOVERY KIT GENERATED — first boot",
			"codes", len(plain),
			"note", "regenerate from Settings to download them")
		_ = st.AppendAuditDetail("system", "recovery_init", "admin/recovery", "first boot generation",
			storeRequestAudit())
	}
	var handler = apiServer.Router(authSvc, adminServer, func(m *http.ServeMux) {
		m.HandleFunc("POST /admin/password", adminServer.ChangePassword)
		m.HandleFunc("POST /admin/recovery/generate", adminServer.RecoveryGenerate)
		m.HandleFunc("GET /admin/recovery/status", adminServer.RecoveryStatus)
		webSrv.AttachAdmin(m)
	})
	// MCP over streamable HTTP, behind the same agent-key auth as /v1
	if mcpHandler, err := agmcp.HTTPHandler(agmcp.Deps{Store: st, Enc: enc, Auth: authSvc}); err == nil {
		mux := http.NewServeMux()
		mux.Handle("/mcp", authSvc.Authenticate(apiServer.AgentAudit(mcpHandler)))
		mux.Handle("/", handler)
		handler = mux
	}
	// Webui SPA + webui-specific admin endpoints (reveal/delete are session-guarded
	// via the api router's admin mux; the SPA shell itself is public static files —
	// data protection is enforced by /admin/* and /v1/* middleware)
	webMux := http.NewServeMux()
	webSrv.Routes(webMux)
	// Security headers on every response (hardening; UI is same-origin, no external assets)
	headers := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r)
		})
	}
	mux2 := http.NewServeMux()
	mux2.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/ui/", http.StatusSeeOther)
	})
	setupMgr.Mount(mux2, authSvc, st)
	mux2.Handle("/ui/", webMux)
	mux2.Handle("/", handler)
	handler = headers(mux2)

	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second, // slowloris
	}

	slog.Info("kervia-vault listening", "addr", cfg.ListenAddr)
	if cfg.CertFile != "" {
		slog.Error("TLS", "err", srv.ListenAndServeTLS(cfg.CertFile, cfg.KeyFile))
	} else {
		slog.Error("serve", "err", srv.ListenAndServe())
	}
	os.Exit(1)
}

func filepathOf(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			return p[:i]
		}
	}
	return ""
}

// runMCPStdio runs the MCP server in subprocess mode (stdio transport).
// Requires KERVIA_VAULT_API_KEY in the environment; config from the same
// env vars as the server. Errors go to stderr only (stdout is the protocol).
func runMCPStdio() {
	fail := func(err error) {
		_, _ = os.Stderr.WriteString("kervia-vault mcp: " + err.Error() + "\n")
		os.Exit(1)
	}
	cfg, err := config.FromEnv()
	if err != nil {
		fail(err)
	}
	if dir := filepathOf(cfg.DBPath); dir != "" {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			fail(err)
		}
	}
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		fail(err)
	}
	defer func() { _ = st.Close() }()
	enc, err := crypto.NewEncryptorFromHex(cfg.MasterKey)
	if err != nil {
		fail(err)
	}
	authSvc := auth.New(st, cfg.AdminHash, cfg.RatePerMin)
	if err := agmcp.RunStdio(agmcp.Deps{Store: st, Enc: enc, Auth: authSvc}); err != nil {
		fail(err)
	}
}

// runHashPw prints a bcrypt hash of the password (arg 1 or stdin).
func runHashPw(args []string) {
	var pw string
	if len(args) > 0 {
		pw = args[0]
	} else {
		_, _ = fmt.Fscanln(os.Stdin, &pw)
	}
	if pw == "" {
		_, _ = os.Stderr.WriteString("usage: kervia-vault hashpw <password>\n")
		os.Exit(1)
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pw), 12)
	if err != nil {
		_, _ = os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	fmt.Println(string(h))
}

func storeRequestAudit() store.RequestInfo {
	return store.RequestInfo{Source: "system", Method: "init", Status: 200, Path: "/admin/recovery"}
}
