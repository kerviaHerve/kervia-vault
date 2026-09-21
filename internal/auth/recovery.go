// Recovery codes: one-time-use codes that let the admin reset their password
// without server access. Hashed at rest (Argon2id, same scheme as API keys),
// each single-use, 10 codes per generation.
//
// The DOWNLOADABLE kit contains the plaintext codes (shown once) and, with a
// clear warning, the master encryption key — losing both the password and
// the master key means the vault data is unrecoverable (AES-256-GCM, no
// escrow server-side).
//
// SPDX-License-Identifier: AGPL-3.0

package auth

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"

	"golang.org/x/crypto/bcrypt"

	"github.com/kerviaHerve/kervia-vault/internal/store"
)

// RecoveryCode represents a single stored (hashed) recovery code.
type RecoveryCode struct {
	Hash    string // bcrypt hash of "AGV-XXXX-XXXX" (single code)
	Used    bool
}

// recoveryStore keeps the hashed codes in memory; persistence is handled
// by the caller (JSON file next to the DB, 0600).
type recoveryStore struct {
	mu    sync.RWMutex
	codes []RecoveryCode
	path  string
}

// newRecoveryCodes generates N single-use codes in the form AGV-XXXXX-XXXXX.
// Returns (store, plaintextCodes) — the plaintext is returned ONCE for download.
func newRecoveryCodes(n int) (plaintext []string, hashes []string) {
	plaintext = make([]string, 0, n)
	hashes = make([]string, 0, n)
	for i := 0; i < n; i++ {
		raw := make([]byte, 5) // 5 bytes = 10 hex chars, split in two groups of 5
		if _, err := io.ReadFull(rand.Reader, raw); err != nil {
			continue
		}
		h := strings.ToUpper(hex.EncodeToString(raw))
		code := "AGV-" + h[:5] + "-" + h[5:]
		plaintext = append(plaintext, code)
		hashes = append(hashes, hashRecoveryCode(code))
	}
	return plaintext, hashes
}

// hashRecoveryCode bcrypt-hashes a single recovery code (min cost: these
// are random high-entropy tokens, cost 10 suffices).
func hashRecoveryCode(code string) string {
	h, _ := bcrypt.GenerateFromPassword([]byte(code), 10)
	return string(h)
}

// verifyRecoveryCode checks a submitted code against all stored hashes,
// returning the index if found (and unused), or -1.
func (s *recoveryStore) verifyAndMark(code string) int {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return -1
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, rc := range s.codes {
		if !rc.Used && bcrypt.CompareHashAndPassword([]byte(rc.Hash), []byte(code)) == nil {
			s.codes[i].Used = true
			return i
		}
	}
	return -1
}

// remaining returns how many unused codes are left.
func (s *recoveryStore) remaining() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	n := 0
	for _, rc := range s.codes {
		if !rc.Used {
			n++
		}
	}
	return n
}
// EnsureRecoveryCodes generates + persists codes on FIRST boot only.
// Returns the plaintext ONCE (nil if already existed).
func (s *Service) EnsureRecoveryCodes() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.recovery != nil && len(s.recovery.codes) > 0 {
		return nil // déjà générés
	}
	plain, hashes := newRecoveryCodes(10)
	s.recovery = &recoveryStore{path: s.recoveryPath, codes: make([]RecoveryCode, len(hashes))}
	for i, h := range hashes {
		s.recovery.codes[i] = RecoveryCode{Hash: h, Used: false}
	}
	s.persistRecovery()
	return plain
}

// RegenerateRecoveryCodes replaces all codes (admin action from settings).
// Returns the new plaintext codes (downloadable once).
func (s *Service) RegenerateRecoveryCodes(currentPassword string) []string {
	if !s.CheckAdmin(currentPassword) {
		return nil
	}
	plain, hashes := newRecoveryCodes(10)
	s.mu.Lock()
	s.recovery = &recoveryStore{path: s.recoveryPath, codes: make([]RecoveryCode, len(hashes))}
	for i, h := range hashes {
		s.recovery.codes[i] = RecoveryCode{Hash: h, Used: false}
	}
	s.mu.Unlock()
	s.persistRecovery()
	return plain
}

// RecoverWithCode validates a recovery code and resets the admin password.
// Returns true if the code was valid and the password was changed.
func (s *Service) RecoverWithCode(code, newPassword string) bool {
	if len(newPassword) < 12 {
		return false
	}
	s.mu.Lock()
	idx := s.recovery.verifyAndMark(code)
	if idx < 0 {
		s.mu.Unlock()
		return false
	}
	s.mu.Unlock()
	_ = s.SetAdminPassword(newPassword)
	s.persistRecovery()
	return true
}

// RecoveryRemaining reports how many unused codes are left.
func (s *Service) RecoveryRemaining() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.recovery == nil {
		return 0
	}
	return s.recovery.remaining()
}

// persistRecovery writes the hashed codes to disk (JSON, 0600, next to DB).
func (s *Service) persistRecovery() {
	if s.recovery == nil || s.recovery.path == "" {
		return
	}
	b, _ := json.Marshal(s.recovery.codes)
	_ = os.WriteFile(s.recovery.path, b, 0o600)
}

// LoadRecoveryCodes reads the persisted hashed codes at boot.
func (s *Service) LoadRecoveryCodes() {
	if s.recoveryPath == "" {
		return
	}
	b, err := os.ReadFile(s.recoveryPath) // #nosec G304 -- admin-controlled path next to DB
	if err != nil {
		return
	}
	var codes []RecoveryCode
	if json.Unmarshal(b, &codes) == nil && len(codes) > 0 {
		s.mu.Lock()
		s.recovery = &recoveryStore{path: s.recoveryPath, codes: codes}
		s.mu.Unlock()
	}
}

// AuditRecoveryFail logs a failed recovery attempt (never the code itself).
func (s *Service) AuditRecoveryFail(r *http.Request) error {
	return s.store.AppendAuditDetail("admin", "recovery_fail", "recovery/recover", "",
		requestAudit(r, 401))
}

// AuditRecoverySuccess logs a successful password recovery via code.
func (s *Service) AuditRecoverySuccess(r *http.Request) error {
	return s.store.AppendAuditDetail("admin", "recovery_success", "recovery/recover", "",
		requestAudit(r, 200))
}

// requestAudit extracts the caller's IP/UA for audit details.
func requestAudit(r *http.Request, status int) store.RequestInfo {
	ip := r.RemoteAddr
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		ip = h
	}
	ua := r.UserAgent()
	if len(ua) > 200 {
		ua = ua[:200]
	}
	return store.RequestInfo{Source: "webui", IP: ip, UserAgent: ua, Method: r.Method, Status: status, Path: "/recovery/recover"}
}

// SetRecoveryPath tells the service where hashed codes persist.
func (s *Service) SetRecoveryPath(p string) { s.recoveryPath = p }
