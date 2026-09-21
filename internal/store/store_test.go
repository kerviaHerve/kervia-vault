// Store tests with an in-memory-like temp SQLite database.
// SPDX-License-Identifier: AGPL-3.0

package store

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kerviaHerve/kervia-vault/internal/crypto"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestCreateAndGetAgent(t *testing.T) {
	s := newTestStore(t)
	full, prefix, hash, _ := crypto.GenerateAPIKey()
	a, err := s.CreateAgent("agent-1", "rita", hash, prefix)
	if err != nil {
		t.Fatalf("CreateAgent: %v", err)
	}
	if a.Name != "rita" {
		t.Fatalf("name = %q", a.Name)
	}
	// duplicate name must conflict
	if _, err := s.CreateAgent("agent-2", "rita", hash, prefix); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate accepted: %v", err)
	}
	// verify path
	got, err := s.GetAgentForKeyVerify("agent-1")
	if err != nil {
		t.Fatalf("GetAgentForKeyVerify: %v", err)
	}
	if !crypto.VerifyAPIKey(full, got) {
		t.Fatal("key hash mismatch after storage")
	}
	_ = strings.TrimSpace("") // keep strings imported
}

func TestRevokeAgent(t *testing.T) {
	s := newTestStore(t)
	_, prefix, hash, _ := crypto.GenerateAPIKey()
	s.CreateAgent("a1", "x", hash, prefix)
	if err := s.RevokeAgent("a1"); err != nil {
		t.Fatalf("RevokeAgent: %v", err)
	}
	if _, err := s.GetAgentForKeyVerify("a1"); err == nil {
		t.Fatal("revoked agent still passes key verification")
	}
	if err := s.RevokeAgent("a1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("double revoke = %v, want ErrNotFound", err)
	}
}

func TestVaultsAndGrants(t *testing.T) {
	s := newTestStore(t)
	s.CreateVault("v1", "rita-vault")
	s.CreateVault("v2", "shared")
	s.CreateAgent("a1", "agent1", "h", "p")

	ok, err := s.HasGrant("a1", "v1", false)
	if err != nil || ok {
		t.Fatalf("grant before AddGrant: ok=%v err=%v", ok, err)
	}
	s.AddGrant("a1", "v1", true)

	ok, _ = s.HasGrant("a1", "v1", false)
	if !ok {
		t.Fatal("read grant missing")
	}
	ok, _ = s.HasGrant("a1", "v1", true)
	if !ok {
		t.Fatal("write grant missing")
	}
	ok, _ = s.HasGrant("a1", "v2", false)
	if ok {
		t.Fatal("implicit grant on v2 — deny by default violated")
	}
	vaults, _ := s.ListVaultsForAgent("a1")
	if len(vaults) != 1 || vaults[0].Name != "rita-vault" {
		t.Fatalf("ListVaultsForAgent = %v", vaults)
	}
}

func TestSecretLifecycle(t *testing.T) {
	s := newTestStore(t)
	enc, _ := crypto.NewEncryptorFromHex(strings.Repeat("ab", 32))
	s.CreateVault("v1", "vault")
	s.CreateAgent("a1", "agent", "h", "p")

	nonce, ct, _ := enc.Encrypt([]byte("password123"))
	sec, err := s.CreateSecret("s1", "v1", "DB_PASS", nonce, ct, "sv1", "a1")
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	if sec.Version != 1 {
		t.Fatalf("version = %d", sec.Version)
	}
	// duplicate key conflicts
	if _, err := s.CreateSecret("s2", "v1", "DB_PASS", nonce, ct, "sv2", "a1"); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate key accepted: %v", err)
	}

	got, n2, c2, err := s.GetSecretByKey("v1", "DB_PASS")
	if err != nil {
		t.Fatalf("GetSecretByKey: %v", err)
	}
	val, _ := enc.Decrypt(n2, c2)
	if string(val) != "password123" {
		t.Fatalf("decrypted = %q", val)
	}
	_ = got

	// update → version 2
	nonce2, ct2, _ := enc.Encrypt([]byte("password456"))
	if err := s.UpdateSecretValue("s1", nonce2, ct2, "a1", "sv2"); err != nil {
		t.Fatalf("UpdateSecretValue: %v", err)
	}
	_, n3, c3, _ := s.GetSecretByID("s1")
	val3, _ := enc.Decrypt(n3, c3)
	if string(val3) != "password456" {
		t.Fatalf("after update = %q", val3)
	}
	versions, _ := s.ListVersions("s1")
	if len(versions) != 2 {
		t.Fatalf("versions = %d, want 2", len(versions))
	}

	// delete
	if err := s.DeleteSecret("s1"); err != nil {
		t.Fatalf("DeleteSecret: %v", err)
	}
	if _, _, _, err := s.GetSecretByID("s1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted secret still readable: %v", err)
	}
	if err := s.DeleteSecret("s1"); !errors.Is(err, ErrNotFound) {
		t.Fatal("double delete accepted")
	}
}

func TestAuditAppendOnly(t *testing.T) {
	s := newTestStore(t)
	for i := 0; i < 5; i++ {
		if err := s.AppendAudit("admin", "read", "vault/v/secret/k", ""); err != nil {
			t.Fatalf("AppendAudit: %v", err)
		}
	}
	entries, err := s.ListAudit(10, 0, "")
	if err != nil {
		t.Fatalf("ListAudit: %v", err)
	}
	if len(entries) != 5 {
		t.Fatalf("entries = %d", len(entries))
	}
	// newest first
	if entries[0].ID != 5 {
		t.Fatalf("order wrong: first ID = %d", entries[0].ID)
	}
	// filter
	filtered, _ := s.ListAudit(10, 0, "nobody")
	if len(filtered) != 0 {
		t.Fatal("filter returned foreign entries")
	}
}