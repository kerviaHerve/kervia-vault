// Auth: API key middleware + admin session + rate limiting.
// SPDX-License-Identifier: AGPL-3.0

package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/model"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

type ctxKey int

const agentKey ctxKey = 1

// ctxKeyAdmin marks an authenticated webui admin session.
const adminKey ctxKey = 2

// Service holds auth dependencies.
type Service struct {
	store     *store.Store
	rate      *rateLimiter
	adminHash string // bcrypt
	sessions  sync.Map // sessionID -> expiry
}

// New builds the auth service.
func New(st *store.Store, adminHash string, ratePerMin int) *Service {
	return &Service{store: st, adminHash: adminHash, rate: newRateLimiter(ratePerMin)}
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
	return bcrypt.CompareHashAndPassword([]byte(s.adminHash), []byte(password)) == nil
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

// AdminMiddleware validates the session cookie on /admin/* routes.
func (s *Service) AdminMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("av_session")
		if err != nil {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		v, ok := s.sessions.Load(c.Value)
		if !ok || v.(time.Time).Before(time.Now()) {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), adminKey, true)
		next.ServeHTTP(w, r.WithContext(ctx))
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
