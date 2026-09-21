// Auth tests: middleware, key verification, rate limiting, admin sessions.
// SPDX-License-Identifier: AGPL-3.0

package auth

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

func newTestAuth(t *testing.T) (*Service, string, *store.Store) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "auth.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	adminHash, _ := bcrypt.GenerateFromPassword([]byte("admin-pw"), bcrypt.MinCost)
	svc := New(st, string(adminHash), 1000)
	// create an agent with a real key
	full, prefix, hash, _ := crypto.GenerateAPIKey()
	st.CreateAgent("a1", "test-agent", hash, prefix)
	return svc, full, st
}

func TestAuthenticateValid(t *testing.T) {
	svc, key, _ := newTestAuth(t)
	called := false
	h := svc.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		agent, ok := AgentFrom(r.Context())
		if !ok || agent.Name != "test-agent" {
			t.Fatalf("agent not in context: %v", agent)
		}
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/v1/whoami", nil)
	req.Header.Set("Authorization", "Bearer "+key)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !called || rec.Code != 200 {
		t.Fatalf("valid key rejected: code=%d called=%v", rec.Code, called)
	}
}

func TestAuthenticateRejectsBadKeys(t *testing.T) {
	svc, _, st := newTestAuth(t)
	_ = st
	cases := []string{
		"",                            // no header
		"Bearer ",                     // empty
		"Bearer av_short",             // bad format
		"Bearer bx_" + strings.Repeat("ab", 32), // wrong prefix
		"Bearer av_" + strings.Repeat("cd", 32),  // valid format, unknown key
	}
	for _, c := range cases {
		func() {
			h := svc.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				t.Fatal("handler called with bad key")
			}))
			req := httptest.NewRequest("GET", "/v1/whoami", nil)
			if strings.HasPrefix(c, "Bearer") {
				req.Header.Set("Authorization", c)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("case %q: code=%d, want 401", c[:min(12, len(c))], rec.Code)
			}
		}()
	}
	// failed attempts are audited
	entries, _ := st.ListAudit(10, 0, "")
	if len(entries) == 0 {
		t.Fatal("login failures not audited")
	}
}

func TestAuthenticateRejectsRevoked(t *testing.T) {
	svc, key, st := newTestAuth(t)
	st.RevokeAgent("a1")
	h := svc.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("revoked agent passed")
	}))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+key)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked accepted: %d", rec.Code)
	}
}

func TestRateLimiter(t *testing.T) {
	rl := newRateLimiter(3)
	for i := 0; i < 3; i++ {
		if !rl.allow("k") {
			t.Fatalf("request %d rejected under limit", i+1)
		}
	}
	if rl.allow("k") {
		t.Fatal("4th request accepted — rate limit not enforced")
	}
	// different key unaffected
	if !rl.allow("other") {
		t.Fatal("other key penalised")
	}
}

func TestAdminSession(t *testing.T) {
	svc, _, _ := newTestAuth(t)
	if !svc.CheckAdmin("admin-pw") {
		t.Fatal("correct admin password rejected")
	}
	if svc.CheckAdmin("wrong") {
		t.Fatal("wrong admin password accepted")
	}
	sid := svc.NewAdminSession()
	if sid == "" {
		t.Fatal("empty session id")
	}
	// middleware accepts the cookie
	h := svc.AdminMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !IsAdmin(r.Context()) {
			t.Fatal("admin flag missing")
		}
	}))
	req := httptest.NewRequest("GET", "/admin/agents", nil)
	req.AddCookie(&http.Cookie{Name: "av_session", Value: sid})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("valid session: %d", rec.Code)
	}
	// invalid cookie
	req2 := httptest.NewRequest("GET", "/admin/agents", nil)
	req2.AddCookie(&http.Cookie{Name: "av_session", Value: "bogus"})
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("bogus session: %d", rec2.Code)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func TestFailRateLimiter(t *testing.T) {
	fl := newFailLimiter(5)
	// 5 allowed, then blocked
	for i := 0; i < 5; i++ {
		if !fl.allow("1.2.3.4") {
			t.Fatalf("attempt %d rejected under limit", i+1)
		}
	}
	if fl.allow("1.2.3.4") {
		t.Fatal("6th attempt accepted — brute-force throttle not enforced")
	}
	// different source unaffected
	if !fl.allow("5.6.7.8") {
		t.Fatal("different source penalised")
	}
}

func TestFailedAuthThrottled(t *testing.T) {
	// dedicated service with a TIGHT fail budget: ratePerMin=30 → failPerMin=5
	dbPath := filepath.Join(t.TempDir(), "fl.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	adminHash, _ := bcrypt.GenerateFromPassword([]byte("x"), bcrypt.MinCost)
	svc := New(st, string(adminHash), 30)
	full, prefix, hash, _ := crypto.GenerateAPIKey()
	st.CreateAgent("fl1", "throttle-me", hash, prefix)
	validKey := full
	// THE expensive vector: a key sharing an existing agent's 11-char prefix —
	// each attempt runs Argon2id (94ms, 64MB). Same prefix as the real key.
	bad := validKey[:11] + strings.Repeat("ff", 29)
	h := svc.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler reached with bad key")
	}))
	blocked := false
	for i := 0; i < 30; i++ {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Bearer "+bad)
		req.RemoteAddr = "9.9.9.9:1234"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusTooManyRequests {
			blocked = true
			break
		}
	}
	if !blocked {
		t.Fatal("30 failed attempts never throttled — CPU DoS vector")
	}
	// and the throttle must not have punished a different source
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+validKey)
	req.RemoteAddr = "8.8.8.8:1234"
	rec := httptest.NewRecorder()
	svc.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})).ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("valid key from another source blocked: %d", rec.Code)
	}
	_ = st
}
