// TOTP tests: RFC 6238 vectors + the enroll/confirm/disable state machine.
// SPDX-License-Identifier: AGPL-3.0

package auth

import (
	"os"
	"testing"
	"time"
)

// RFC 6238, Appendix B test vectors (SHA-1, seed ASCII "12345678901234567890").
// The document publishes 8-digit codes; the 6-digit form is the last 6 chars.
func TestTotpRFC6238Vectors(t *testing.T) {
	const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" // base32("12345678901234567890")
	cases := []struct {
		unix int64
		want string
	}{
		{59, "287082"},
		{1111111109, "081804"},
		{1234567890, "005924"},
		{2000000000, "279037"},
	}
	for _, c := range cases {
		got, err := totpAt(seed, time.Unix(c.unix, 0))
		if err != nil {
			t.Fatalf("totpAt(t=%d): %v", c.unix, err)
		}
		if got != c.want {
			t.Errorf("totpAt(t=%d) = %s, want %s", c.unix, got, c.want)
		}
	}
}

func TestVerifyTotpWindow(t *testing.T) {
	seed, err := GenerateTotpSeed()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	code, err := totpAt(seed, now)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyTotp(seed, code) {
		t.Fatal("current code must verify")
	}
	prev, _ := totpAt(seed, now.Add(-totpStep))
	next, _ := totpAt(seed, now.Add(totpStep))
	if !VerifyTotp(seed, prev) || !VerifyTotp(seed, next) {
		t.Fatal("±1 step tolerance (clock drift)")
	}
	far, _ := totpAt(seed, now.Add(-3*totpStep))
	if VerifyTotp(seed, far) {
		t.Fatal("a code 3 steps away must NOT verify")
	}
	if VerifyTotp(seed, "12345") || VerifyTotp(seed, "abcdef") || VerifyTotp(seed, "") {
		t.Fatal("malformed codes must fail")
	}
}

// The enrollment state machine: none → pending (enroll) → active (confirm) →
// none (disable). A recovery reset wipes both states.
func TestTotpStateMachine(t *testing.T) {
	dir := t.TempDir()
	var svc Service
	svc.SetHashPath(dir + "/admin_hash")

	if got := svc.TOTPState(); got != "none" {
		t.Fatalf("fresh service: state = %s, want none", got)
	}
	if svc.TOTPRequired() {
		t.Fatal("fresh service must not require 2FA")
	}

	seed, uri, err := svc.TOTPEnroll()
	if err != nil {
		t.Fatal(err)
	}
	if len(seed) != 32 || uri == "" {
		t.Fatalf("seed = %q (len %d), uri = %q", seed, len(seed), uri)
	}
	if got := svc.TOTPState(); got != "pending" {
		t.Fatalf("after enroll: state = %s, want pending", got)
	}
	if svc.TOTPRequired() {
		t.Fatal("pending enrollment must not lock the login yet")
	}

	// wrong code does not activate
	if err := svc.TOTPConfirm("000000"); err == nil {
		t.Fatal("confirm with wrong code must fail")
	}
	if got := svc.TOTPState(); got != "pending" {
		t.Fatalf("failed confirm must keep pending, got %s", got)
	}

	code, _ := totpAt(seed, time.Now())
	if err := svc.TOTPConfirm(code); err != nil {
		t.Fatalf("confirm with valid code: %v", err)
	}
	if got := svc.TOTPState(); got != "active" {
		t.Fatalf("after confirm: state = %s, want active", got)
	}
	if !svc.TOTPRequired() {
		t.Fatal("active state must require 2FA at login")
	}
	if !svc.TOTPCheck(code) {
		t.Fatal("TOTPCheck with the valid code must pass")
	}

	// re-enroll while active is refused
	if _, _, err := svc.TOTPEnroll(); err == nil {
		t.Fatal("re-enroll while active must be refused")
	}

	// disable: wrong code refused, right code accepted
	if svc.TOTPDisable("000000") {
		t.Fatal("disable with wrong code must fail")
	}
	if !svc.TOTPDisable(code) {
		t.Fatal("disable with the valid code must succeed")
	}
	if got := svc.TOTPState(); got != "none" {
		t.Fatalf("after disable: state = %s, want none", got)
	}
}

func TestTotpResetByRecovery(t *testing.T) {
	dir := t.TempDir()
	var svc Service
	svc.SetHashPath(dir + "/admin_hash")
	seed, _, err := svc.TOTPEnroll()
	if err != nil {
		t.Fatal(err)
	}
	code, _ := totpAt(seed, time.Now())
	if err := svc.TOTPConfirm(code); err != nil {
		t.Fatal(err)
	}
	if !svc.TOTPRequired() {
		t.Fatal("TOTP must be active here")
	}
	svc.totpReset()
	if svc.TOTPRequired() || svc.TOTPState() != "none" {
		t.Fatal("recovery reset must wipe the TOTP entirely")
	}
}

// The seed files must never be world-readable (credential material).
func TestTotpSeedFilePerms(t *testing.T) {
	dir := t.TempDir()
	var svc Service
	svc.SetHashPath(dir + "/admin_hash")
	if _, _, err := svc.TOTPEnroll(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(totpPendingPath())
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("pending seed perms = %o, want 600", info.Mode().Perm())
	}
}