// Benchmarks: the SPEC promises read p99 < 5ms, write p99 < 15ms.
// These measure the store layer round-trip (the dominant cost) — HTTP adds
// ~1ms of overhead. Run: go test -bench . -benchmem ./internal/store/
//
// SPDX-License-Identifier: AGPL-3.0

package store

import (
	"fmt"
	"strings"
	"testing"

	"github.com/kerviaHerve/kervia-vault/internal/crypto"
)

func benchStore(b *testing.B) *Store {
	dbPath := b.TempDir() + "/bench.db"
	s, err := Open(dbPath)
	if err != nil {
		b.Fatalf("Open: %v", err)
	}
	b.Cleanup(func() { s.Close() })
	return s
}

func BenchmarkRead(b *testing.B) {
	s := benchStore(b)
	enc, _ := crypto.NewEncryptorFromHex(strings.Repeat("ab", 32))
	s.CreateVault("v1", "bench")
	s.CreateAgent("a1", "a", "h", "p")
	nonce, ct, _ := enc.Encrypt([]byte("value"))
	s.CreateSecret("s1", "v1", "KEY", "", nonce, ct, "sv1", "a1")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, nonce, ct, err := s.GetSecretByKey("v1", "KEY")
		if err != nil {
			b.Fatal(err)
		}
		if _, err := enc.Decrypt(nonce, ct); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkWrite(b *testing.B) {
	s := benchStore(b)
	enc, _ := crypto.NewEncryptorFromHex(strings.Repeat("ab", 32))
	s.CreateVault("v1", "bench")
	s.CreateAgent("a1", "a", "h", "p")
	nonce, ct, _ := enc.Encrypt([]byte("v1"))
	s.CreateSecret("s1", "v1", "KEY", "", nonce, ct, "sv1", "a1")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		n, c, _ := enc.Encrypt([]byte("value"))
		if err := s.UpdateSecretValue("s1", n, c, "a1", fmt.Sprintf("sv-%d", i)); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkCreate(b *testing.B) {
	s := benchStore(b)
	enc, _ := crypto.NewEncryptorFromHex(strings.Repeat("ab", 32))
	s.CreateVault("v1", "bench")
	s.CreateAgent("a1", "a", "h", "p")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		n, c, _ := enc.Encrypt([]byte("value"))
		id := fmt.Sprintf("s-%d", i)
		if _, err := s.CreateSecret(id, "v1", "K"+id, "", n, c, id+"v", "a1"); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkAPIKeyVerify(b *testing.B) {
	full, _, hash, _ := crypto.GenerateAPIKey()
	_ = full
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if !crypto.VerifyAPIKey(full, hash) {
			b.Fatal("verify failed")
		}
	}
}