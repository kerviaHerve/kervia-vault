// Package crypto tests — security-critical, 100% coverage target.
// SPDX-License-Identifier: AGPL-3.0

package crypto

import (
	"bytes"
	"strings"
	"testing"
)

func TestEncryptDecryptRoundTrip(t *testing.T) {
	enc, err := NewEncryptorFromHex(strings.Repeat("ab", 32))
	if err != nil {
		t.Fatalf("NewEncryptorFromHex: %v", err)
	}
	plaintext := []byte("my-secret-token-12345")
	nonce, ct, err := enc.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	got, err := enc.Decrypt(nonce, ct)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("round trip mismatch: %q != %q", got, plaintext)
	}
}

func TestEncryptNonceUniqueness(t *testing.T) {
	enc, _ := NewEncryptorFromHex(strings.Repeat("cd", 32))
	seen := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		nonce, _, err := enc.Encrypt([]byte("x"))
		if err != nil {
			t.Fatalf("Encrypt: %v", err)
		}
		if seen[string(nonce)] {
			t.Fatal("nonce reuse detected — critical security violation")
		}
		seen[string(nonce)] = true
	}
}

func TestDecryptRejectsTampering(t *testing.T) {
	enc, _ := NewEncryptorFromHex(strings.Repeat("ef", 32))
	nonce, ct, _ := enc.Encrypt([]byte("secret"))
	// flip one bit of the ciphertext
	ct[0] ^= 0x01
	if _, err := enc.Decrypt(nonce, ct); err == nil {
		t.Fatal("tampered ciphertext was accepted — GCM tag check failed")
	}
}

func TestDecryptRejectsWrongKey(t *testing.T) {
	enc1, _ := NewEncryptorFromHex(strings.Repeat("11", 32))
	enc2, _ := NewEncryptorFromHex(strings.Repeat("22", 32))
	nonce, ct, _ := enc1.Encrypt([]byte("secret"))
	if _, err := enc2.Decrypt(nonce, ct); err == nil {
		t.Fatal("decryption with wrong master key succeeded")
	}
}

func TestDecryptRejectsBadNonceSize(t *testing.T) {
	enc, _ := NewEncryptorFromHex(strings.Repeat("33", 32))
	if _, err := enc.Decrypt([]byte("short"), []byte("data")); err == nil {
		t.Fatal("short nonce accepted")
	}
}

func TestNewEncryptorRejectsBadKey(t *testing.T) {
	if _, err := NewEncryptor(nil); err == nil {
		t.Fatal("nil master key accepted")
	}
	if _, err := NewEncryptor(make([]byte, 16)); err == nil {
		t.Fatal("16-byte master key accepted (must be 32)")
	}
	if _, err := NewEncryptorFromHex("zz"); err == nil {
		t.Fatal("non-hex master key accepted")
	}
}

func TestGenerateAPIKey(t *testing.T) {
	full, prefix, hash, err := GenerateAPIKey()
	if err != nil {
		t.Fatalf("GenerateAPIKey: %v", err)
	}
	if !strings.HasPrefix(full, "av_") {
		t.Fatalf("key missing prefix: %q", full[:6])
	}
	if !ValidateAPIKeyFormat(full) {
		t.Fatal("generated key fails its own format validation")
	}
	if prefix != full[:11] {
		t.Fatalf("prefix %q != %q", prefix, full[:11])
	}
	if hash == "" || strings.Contains(hash, full) {
		t.Fatal("hash empty or contains the raw key — leak")
	}
	// uniqueness
	f2, _, h2, _ := GenerateAPIKey()
	if f2 == full || h2 == hash {
		t.Fatal("two generated keys identical — CSPRNG failure")
	}
}

func TestVerifyAPIKey(t *testing.T) {
	full, _, hash, _ := GenerateAPIKey()
	if !VerifyAPIKey(full, hash) {
		t.Fatal("valid key rejected")
	}
	if VerifyAPIKey("av_"+"0000000000000000"+"0", hash) {
		t.Fatal("wrong key accepted")
	}
	if VerifyAPIKey(full, "argon2id:bogus") {
		t.Fatal("bogus hash accepted")
	}
}

func TestValidateAPIKeyFormat(t *testing.T) {
	cases := []struct {
		key  string
		want bool
	}{
		{"", false},
		{"av_", false},
		{"av_1234", false},
		{"bx_" + strings.Repeat("ab", 32), false},
		{"av_" + strings.Repeat("zz", 32), false}, // not hex
		{"av_" + strings.Repeat("ab", 32), true},
	}
	for _, c := range cases {
		if got := ValidateAPIKeyFormat(c.key); got != c.want {
			t.Errorf("ValidateAPIKeyFormat(%q...) = %v, want %v", c.key[:min(6, len(c.key))], got, c.want)
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}