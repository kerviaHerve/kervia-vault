// Recovery codes tests — generation, single-use, password reset flow.
// SPDX-License-Identifier: AGPL-3.0

package auth

import (
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/kerviaHerve/kervia-vault/internal/store"
)

func newRecoveryService(t *testing.T) (*Service, []string) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "rec.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	adminHash, _ := bcrypt.GenerateFromPassword([]byte("start-pass-1234"), bcrypt.MinCost)
	svc := New(st, string(adminHash), 100000)
	svc.SetHashPath(filepath.Join(t.TempDir(), "hash"))
	svc.SetRecoveryPath(filepath.Join(t.TempDir(), "recovery.json"))

	plain := svc.EnsureRecoveryCodes()
	if plain == nil {
		t.Fatal("first-boot generation returned nil")
	}
	if len(plain) != 10 {
		t.Fatalf("expected 10 codes, got %d", len(plain))
	}
	return svc, plain
}

func TestRecoveryCodesGeneratedOnce(t *testing.T) {
	svc, _ := newRecoveryService(t)
	// second call: already exist → nil (not regenerated)
	if svc.EnsureRecoveryCodes() != nil {
		t.Fatal("codes regenerated on second call — would invalidate the downloaded kit")
	}
}

func TestRecoveryCodeFormat(t *testing.T) {
	_, codes := newRecoveryService(t)
	for _, c := range codes {
		if !strings.HasPrefix(c, "AGV-") || len(c) != 15 {
			t.Fatalf("bad format: %q", c)
		}
		if strings.Count(c, "-") != 2 {
			t.Fatalf("expected AGV-XXXXX-XXXXX: %q", c)
		}
	}
}

func TestRecoverWithCode(t *testing.T) {
	svc, codes := newRecoveryService(t)
	// wrong code
	if svc.RecoverWithCode("AGV-XXXXX-XXXXX", "new-password-1234") {
		t.Fatal("invalid code accepted")
	}
	// short password
	if svc.RecoverWithCode(codes[0], "short") {
		t.Fatal("short password accepted")
	}
	// valid
	if !svc.RecoverWithCode(codes[0], "new-password-1234") {
		t.Fatal("valid code rejected")
	}
	if !svc.CheckAdmin("new-password-1234") {
		t.Fatal("password not changed after recovery")
	}
	// single-use: the same code cannot reset again
	if svc.RecoverWithCode(codes[0], "another-pass-1234") {
		t.Fatal("code reusable — must be single-use")
	}
	// remaining decremented
	if svc.RecoveryRemaining() != 9 {
		t.Fatalf("remaining = %d, want 9", svc.RecoveryRemaining())
	}
}

func TestRecoveryPersistence(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "rec2.db")
	st, _ := store.Open(dbPath)
	defer st.Close()
	adminHash, _ := bcrypt.GenerateFromPassword([]byte("x"), bcrypt.MinCost)
	svc := New(st, string(adminHash), 100000)
	dir := t.TempDir()
	svc.SetRecoveryPath(filepath.Join(dir, "recovery.json"))
	plain := svc.EnsureRecoveryCodes()

	// simulate a restart: new service reads the same file
	svc2 := New(st, string(adminHash), 100000)
	svc2.SetRecoveryPath(filepath.Join(dir, "recovery.json"))
	svc2.LoadRecoveryCodes()
	if svc2.recovery == nil {
		t.Fatal("recovery store NIL after LoadRecoveryCodes")
	}
	if svc2.RecoveryRemaining() != 10 {
		t.Fatalf("codes lost after restart: %d", svc2.RecoveryRemaining())
	}
	if !svc2.RecoverWithCode(plain[0], "recovered-pass-1") {
		t.Fatal("code from previous boot rejected")
	}
}

func TestRegenerateRequiresPassword(t *testing.T) {
	svc, _ := newRecoveryService(t)
	if svc.RegenerateRecoveryCodes("wrong") != nil {
		t.Fatal("regeneration without correct password allowed")
	}
	plain := svc.RegenerateRecoveryCodes("start-pass-1234")
	if plain == nil || len(plain) != 10 {
		t.Fatal("regeneration failed with correct password")
	}
	if svc.RecoveryRemaining() != 10 {
		t.Fatal("old codes not invalidated by regeneration")
	}
}
