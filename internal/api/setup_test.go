// Setup wizard tests — the first-boot security invariants:
//   - a REAL deployment (non-placeholder admin hash) is never re-opened
//     in wizard mode (upgrade takeover fix)
//   - /setup/init works pre-flag, 410s after
//   - /setup/init is rate-limited per source
//   - the wizard info endpoint leaks no server paths
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

// newSetupEnv builds a SetupManager wired like main.go does, on a temp dir.
// adminHash is the ENV hash the instance boots with.
func newSetupEnv(t *testing.T, adminHash string) (*SetupManager, *auth.Service, *store.Store) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "kervia-vault.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	authSvc := auth.New(st, adminHash, 60)
	mgr := NewSetupManager(dir, dbPath, "127.0.0.1:8321", "test")
	return mgr, authSvc, st
}

func setupMux(t *testing.T, mgr *SetupManager, authSvc *auth.Service, st *store.Store) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mgr.Mount(mux, authSvc, st)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return ts
}

func postSetup(t *testing.T, url, ip, pw string) *http.Response {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"admin_password": pw})
	req, _ := http.NewRequest("POST", url+"/setup/init", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Real-IP", ip) // clientIP honors it (proxy path)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /setup/init: %v", err)
	}
	return res
}

func TestSetupInitFreshInstall(t *testing.T) {
	// placeholder hash (what install.sh generates) → wizard mode open
	ph, _ := bcrypt.GenerateFromPassword([]byte(auth.AdminPlaceholderPassword), bcrypt.MinCost)
	mgr, authSvc, st := newSetupEnv(t, string(ph))
	ts := setupMux(t, mgr, authSvc, st)

	if mgr.Done() {
		t.Fatal("fresh install should NOT be done")
	}

	res := postSetup(t, ts.URL, "10.0.0.5", "a-valid-password-123")
	if res.StatusCode != 200 {
		t.Fatalf("setup/init on fresh install = %d, want 200", res.StatusCode)
	}
	var body struct {
		RecoveryCodes []string `json:"recovery_codes"`
	}
	_ = json.NewDecoder(res.Body).Decode(&body)
	res.Body.Close()
	if len(body.RecoveryCodes) != 10 {
		t.Fatalf("recovery codes = %d, want 10", len(body.RecoveryCodes))
	}
	if !mgr.Done() {
		t.Fatal("setup_done flag must be written after init")
	}
	// second call → gone
	res2 := postSetup(t, ts.URL, "10.0.0.5", "another-password-123")
	defer res2.Body.Close()
	if res2.StatusCode != 410 {
		t.Fatalf("second setup/init = %d, want 410", res2.StatusCode)
	}
}

func TestSetupReconcileBlocksUpgradeTakeover(t *testing.T) {
	// an EXISTING instance: real password (not the public placeholder).
	// Reconcile must mark setup done BEFORE any endpoint is reachable.
	realHash, _ := bcrypt.GenerateFromPassword([]byte("existing-real-password"), bcrypt.MinCost)
	mgr, authSvc, st := newSetupEnv(t, string(realHash))
	mgr.Reconcile(authSvc) // main.go runs this at boot

	if !mgr.Done() {
		t.Fatal("Reconcile must mark done when a real admin password exists")
	}
	ts := setupMux(t, mgr, authSvc, st)
	res := postSetup(t, ts.URL, "10.0.0.99", "attacker-password-1")
	defer res.Body.Close()
	if res.StatusCode != 410 {
		t.Fatalf("setup/init after Reconcile = %d, want 410 (upgrade takeover!)", res.StatusCode)
	}
}

func TestSetupReconcileKeepsPlaceholderOpen(t *testing.T) {
	// fresh install with the placeholder → Reconcile must NOT close the wizard
	ph, _ := bcrypt.GenerateFromPassword([]byte(auth.AdminPlaceholderPassword), bcrypt.MinCost)
	mgr, authSvc, _ := newSetupEnv(t, string(ph))
	mgr.Reconcile(authSvc)
	if mgr.Done() {
		t.Fatal("placeholder instance must stay in wizard mode")
	}
}

func TestSetupInitRateLimited(t *testing.T) {
	ph, _ := bcrypt.GenerateFromPassword([]byte(auth.AdminPlaceholderPassword), bcrypt.MinCost)
	mgr, authSvc, st := newSetupEnv(t, string(ph))
	ts := setupMux(t, mgr, authSvc, st)

	// the limiter caps at 3/hour per IP; bad requests (short pw) still consume
	for i := 0; i < 3; i++ {
		res := postSetup(t, ts.URL, "203.0.113.7", "short")
		res.Body.Close()
	}
	res := postSetup(t, ts.URL, "203.0.113.7", "a-valid-password-123")
	defer res.Body.Close()
	if res.StatusCode != 429 {
		t.Fatalf("4th attempt same IP = %d, want 429", res.StatusCode)
	}
	// a different source is unaffected
	res2 := postSetup(t, ts.URL, "203.0.113.8", "a-valid-password-123")
	res2.Body.Close()
	if res2.StatusCode != 200 {
		t.Fatalf("different IP = %d, want 200", res2.StatusCode)
	}
}

func TestSetupInfoLeaksNothing(t *testing.T) {
	ph, _ := bcrypt.GenerateFromPassword([]byte(auth.AdminPlaceholderPassword), bcrypt.MinCost)
	mgr, authSvc, st := newSetupEnv(t, string(ph))
	ts := setupMux(t, mgr, authSvc, st)

	res, err := http.Get(ts.URL + "/setup/info")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if strings.Contains(string(raw), ".db") || strings.Contains(string(raw), "/tmp") {
		t.Fatalf("setup/info leaks server paths: %s", raw)
	}
	var info SystemInfo
	if err := json.Unmarshal(raw, &info); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if info.SetupDone {
		t.Fatal("fresh install: setup_done must be false")
	}
}
