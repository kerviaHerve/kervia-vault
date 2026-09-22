// Auth: API key middleware + admin session + rate limiting.
// SPDX-License-Identifier: AGPL-3.0

// Package auth implements Kervia-vault authentication: API keys (Argon2id),
// admin sessions, recovery codes and rate limiting.
package auth

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/model"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

type ctxKey int

const agentKey ctxKey = 1

// WithAgentInCtx stores an authenticated agent in the request context.
// Exported so the MCP layer can read the middleware-resolved identity
// on the HTTP transport (single source of truth — no env fallback there).
func WithAgentInCtx(ctx context.Context, agent *model.Agent) context.Context {
	return context.WithValue(ctx, agentKey, agent)
}

// ctxKeyAdmin marks an authenticated webui admin session.
const adminKey ctxKey = 2

// Service holds auth dependencies.
type Service struct {
	store     *store.Store
	rate      *rateLimiter
	failRate  *failLimiter
	adminHash atomic.Value // string — bcrypt hash, swapped at runtime
	sessions  sync.Map     // sessionID -> expiry

	mu           sync.RWMutex
	recovery     *recoveryStore // hashed single-use codes
	recoveryPath string         // persistence file, next to the DB
}

// adminHashString loads the current hash (atomic).
func (s *Service) adminHashString() string {
	if v, ok := s.adminHash.Load().(string); ok {
		return v
	}
	return ""
}

// New builds the auth service.
// ratePerMin: per-agent bucket. Failed-auth attempts get a smaller,
// stricter bucket (ratePerMin/6) — the Argon2id cost they trigger is high.
func New(st *store.Store, adminHash string, ratePerMin int) *Service {
	failPerMin := ratePerMin / 6
	if failPerMin < 5 {
		failPerMin = 5
	}
	svc := &Service{
		store:    st,
		rate:     newRateLimiter(ratePerMin),
		failRate: newFailLimiter(failPerMin),
	}
	svc.adminHash.Store(adminHash)
	return svc
}

// clientIP extracts the best-effort source for failed-auth throttling.
func clientIP(r *http.Request) string {
	if r.RemoteAddr != "" {
		if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
			return host
		}
		return r.RemoteAddr
	}
	return "unknown"
}

// AgentFrom extracts the authenticated agent from a request context.
func AgentFrom(ctx context.Context) (*model.Agent, bool) {
	a, ok := ctx.Value(agentKey).(*model.Agent)
	return a, ok
}

// IsAdmin reports whether the context carries an admin session.
func IsAdmin(ctx context.Context) bool {
	_, ok := ctx.Value(adminKey).(bool)
	return ok
}

// Authenticate validates the API key: format check → prefix lookup →
// Argon2id verify (constant time) → revoked check → rate limit check.
// A valid agent is injected into the request context.
func (s *Service) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := bearer(r)
		if key == "" || !crypto.ValidateAPIKeyFormat(key) {
			if !s.failRate.allow(clientIP(r)) {
				http.Error(w, `{"error":"rate_limited"}`, http.StatusTooManyRequests)
				return
			}
			s.auditFail(r, "")
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		// prefix = av_ + 8 chars
		prefix := key[:11]
		candidates, err := s.store.ListAgentsByKeyPrefix(prefix)
		if err != nil {
			http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
			return
		}
		var agent *model.Agent
		for _, c := range candidates {
			// full verification happens against the stored hash
			full, err := s.store.GetAgentForKeyVerify(c.ID)
			if err != nil {
				continue
			}
			if crypto.VerifyAPIKey(key, full) {
				agent = c
				break
			}
		}
		if agent == nil {
			// failed verification ran Argon2id — throttle this source
			if !s.failRate.allow(clientIP(r)) {
				http.Error(w, `{"error":"rate_limited"}`, http.StatusTooManyRequests)
				return
			}
			s.auditFail(r, prefix)
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		if !s.rate.allow(agent.ID) {
			_ = s.store.AppendAudit(agent.ID, model.AuditRateLimited, "rate", "")
			http.Error(w, `{"error":"rate_limited"}`, http.StatusTooManyRequests)
			return
		}
		s.store.TouchAgentLastUsed(agent.ID)
		ctx := context.WithValue(r.Context(), agentKey, agent)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// bearer extracts the Authorization: Bearer <key> value.
func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const p = "Bearer "
	if !strings.HasPrefix(h, p) {
		return ""
	}
	return strings.TrimSpace(h[len(p):])
}

// auditFail records a failed login attempt (agent_id = the prefix if
// recognisable, else empty). Never records the key itself.
func (s *Service) auditFail(_ *http.Request, prefix string) {
	_ = s.store.AppendAudit(prefix, model.AuditLoginFail, "auth", "")
}

// CheckAdmin validates the admin password (webui login).
func (s *Service) CheckAdmin(password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(s.adminHashString()), []byte(password)) == nil
}

// LoginAdmin verifies the password with throttling (brute-force protection).
// Returns the session id on success, "" on failure (audited by the caller).
func (s *Service) LoginAdmin(r *http.Request, password string) string {
	if !s.failRate.allow("admin:" + clientIP(r)) {
		return ""
	}
	if !s.CheckAdmin(password) {
		return ""
	}
	return s.NewAdminSession()
}

// NewAdminSession creates a webui session (crypto-random id, 12h expiry).
func (s *Service) NewAdminSession() string {
	id, _, _, err := crypto.GenerateAPIKey() // reuse CSPRNG generator
	if err != nil {
		return ""
	}
	s.sessions.Store(id, time.Now().Add(12*time.Hour))
	return id
}

// StartSessionSweeper periodically removes EXPIRED sessions from the map.
// Load() ignores expired entries but never deletes them — without a sweep
// the map grows forever on a long-lived process (one entry per login).
// A stop channel closes the goroutine; called once from main.
func (s *Service) StartSessionSweeper(interval time.Duration) (stop chan struct{}) {
	stop = make(chan struct{})
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case now := <-t.C:
				s.sessions.Range(func(k, v any) bool {
					if exp, ok := v.(time.Time); ok && now.After(exp) {
						s.sessions.Delete(k)
					}
					return true
				})
			}
		}
	}()
	return stop
}

// AdminMiddleware guards admin routes.
// For browser pages (/ui/*) it redirects to the login screen instead of
// returning a raw 401 — the admin JSON API (/admin/*) keeps the 401 JSON.
func (s *Service) AdminMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("av_session")
		valid := false
		if err == nil {
			if v, ok := s.sessions.Load(c.Value); ok && v.(time.Time).After(time.Now()) {
				valid = true
			}
		}
		if valid {
			ctx := context.WithValue(r.Context(), adminKey, true)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		// no valid session: pages redirect, API stays JSON 401
		if strings.HasPrefix(r.URL.Path, "/ui") {
			http.Redirect(w, r, "/ui/login", http.StatusSeeOther)
			return
		}
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
	})
}

// VerifyKey resolves an agent from a raw API key (MCP stdio path).
// Same verification chain as the middleware, extracted for reuse.
func (s *Service) VerifyKey(key string) (*model.Agent, error) {
	if !crypto.ValidateAPIKeyFormat(key) {
		return nil, errors.New("auth: invalid key format")
	}
	prefix := key[:11]
	candidates, err := s.store.ListAgentsByKeyPrefix(prefix)
	if err != nil {
		return nil, err
	}
	for _, c := range candidates {
		full, err := s.store.GetAgentForKeyVerify(c.ID)
		if err != nil {
			continue
		}
		if crypto.VerifyAPIKey(key, full) {
			return c, nil
		}
	}
	return nil, errors.New("auth: unknown or revoked key")
}

// adminHashPath is where the changed admin hash persists (next to the DB).
// The env var remains the boot-time default; this file overrides it at boot.
var adminHashPath string

// SetHashPath tells the service where to persist admin password changes.
func (s *Service) SetHashPath(p string) { adminHashPath = p }

// SetAdminPassword validates, hashes and swaps the admin password at runtime.
func (s *Service) SetAdminPassword(newPassword string) error {
	if len(newPassword) < 12 {
		return errors.New("auth: password too short")
	}
	h, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		return err
	}
	s.adminHash.Store(string(h))
	if adminHashPath != "" {
		// 0600 — credential material
		if err := os.WriteFile(adminHashPath, h, 0o600); err != nil {
			return fmt.Errorf("auth: persist hash: %w", err)
		}
	}
	return nil
}

// LogoutAdmin revokes a webui session server-side.
func (s *Service) LogoutAdmin(sessionID string) {
	if sessionID != "" {
		s.sessions.Delete(sessionID)
	}
}

// LoadAdminHashOverride reads the persisted hash at boot (if any).
func (s *Service) LoadAdminHashOverride() {
	if adminHashPath == "" {
		return
	}
	h, err := os.ReadFile(adminHashPath) // #nosec G304 -- fixed admin-controlled path (next to DB)
	if err == nil && len(h) > 0 {
		s.adminHash.Store(string(h))
	}
}

// AdminPlaceholderPassword is the public placeholder hash seed used by the
// installer (install.sh) so the server can boot before the wizard runs.
// It is PUBLIC (in the AGPL repo) — that's fine: it only ever means
// "no human has configured this instance yet". The setup manager refuses
// to run the wizard once a real password exists.
const AdminPlaceholderPassword = "setup-placeholder"

// AdminPasswordIsPlaceholder reports whether the effective admin hash still
// verifies the public installer placeholder. Used by the setup manager to
// decide wizard mode (fresh install) vs already-configured instance.
func (s *Service) AdminPasswordIsPlaceholder() bool {
	return bcrypt.CompareHashAndPassword([]byte(s.adminHashString()), []byte(AdminPlaceholderPassword)) == nil
}
