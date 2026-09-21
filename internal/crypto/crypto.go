// Package crypto implements all cryptographic primitives of Kervia-vault.
// Security by design: every function here is reviewed against the
// threat model; NO function may ever log its inputs or outputs.
//
// SPDX-License-Identifier: AGPL-3.0
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Errors are sentinel values — callers use errors.Is, never string matching.
var (
	ErrInvalidMasterKey = errors.New("crypto: master key must be 64 hex chars (32 bytes)")
	ErrDecryptFailed    = errors.New("crypto: decryption failed (wrong key or corrupted data)")
	ErrInvalidAPIKey    = errors.New("crypto: invalid API key format")
)

const (
	// apiKeyPrefix is the visible prefix of every agent API key.
	apiKeyPrefix = "av_"
	// apiKeyRandBytes is the entropy of an API key (32 bytes = 256 bits).
	apiKeyRandBytes = 32
	// nonceSize is the GCM standard nonce length.
	nonceSize = 12
	// keyPrefixLen is how many chars of the API key are stored for display.
	keyPrefixLen = 8
	// argon2 parameters: memory 64MB, 3 iterations, parallelism 2 (OWASP 2024+).
	argon2Time    = 3
	argon2Memory  = 64 * 1024
	argon2Threads = 2
)

// Encryptor holds the master key and performs AES-256-GCM per-secret encryption.
type Encryptor struct {
	aead cipher.AEAD
}

// NewEncryptor builds an AES-256-GCM encryptor from a 32-byte master key.
// The key comes from config (env), never from storage.
func NewEncryptor(masterKey []byte) (*Encryptor, error) {
	if len(masterKey) != 32 {
		return nil, ErrInvalidMasterKey
	}
	block, err := aes.NewCipher(masterKey)
	if err != nil {
		return nil, fmt.Errorf("crypto: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("crypto: %w", err)
	}
	return &Encryptor{aead: aead}, nil
}

// NewEncryptorFromHex parses a 64-hex-char master key.
func NewEncryptorFromHex(hexKey string) (*Encryptor, error) {
	key, err := hex.DecodeString(strings.TrimSpace(hexKey))
	if err != nil || len(key) != 32 {
		return nil, ErrInvalidMasterKey
	}
	return NewEncryptor(key)
}

// Encrypt seals plaintext with AES-256-GCM. Returns (nonce, ciphertext).
// Each call generates a fresh random nonce — never reuse, never deterministic.
func (e *Encryptor) Encrypt(plaintext []byte) (nonce, ciphertext []byte, err error) {
	nonce = make([]byte, nonceSize)
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, fmt.Errorf("crypto: nonce: %w", err)
	}
	ciphertext = e.aead.Seal(nil, nonce, plaintext, nil)
	return nonce, ciphertext, nil
}

// Decrypt opens a GCM seal. Fails closed on any tampering (GCM tag).
func (e *Encryptor) Decrypt(nonce, ciphertext []byte) ([]byte, error) {
	if len(nonce) != nonceSize {
		return nil, ErrDecryptFailed
	}
	plaintext, err := e.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, ErrDecryptFailed
	}
	return plaintext, nil
}

// GenerateAPIKey creates a new agent API key: "av_" + 64 hex chars.
// The full key is returned ONCE (at creation); only the hash is stored.
func GenerateAPIKey() (fullKey, keyPrefix, keyHash string, err error) {
	raw := make([]byte, apiKeyRandBytes)
	if _, err = io.ReadFull(rand.Reader, raw); err != nil {
		return "", "", "", fmt.Errorf("crypto: api key: %w", err)
	}
	fullKey = apiKeyPrefix + hex.EncodeToString(raw)
	keyPrefix = fullKey[:len(apiKeyPrefix)+keyPrefixLen]
	keyHash = HashAPIKey(fullKey)
	return fullKey, keyPrefix, keyHash, nil
}

// ValidateAPIKeyFormat checks the "av_" + 64-hex structure without any lookup.
func ValidateAPIKeyFormat(key string) bool {
	if !strings.HasPrefix(key, apiKeyPrefix) {
		return false
	}
	rest := key[len(apiKeyPrefix):]
	if len(rest) != apiKeyRandBytes*2 {
		return false
	}
	_, err := hex.DecodeString(rest)
	return err == nil
}

// HashAPIKey derives the storage hash with Argon2id (memory-hard).
// Format: "argon2id:v=19$m=65536,t=3,p=2$<hex>" — self-describing for
// future parameter upgrades without breaking existing hashes.
func HashAPIKey(key string) string {
	// Argon2id does not take a password; salt derives from the key itself
	// is WRONG for password hashing, but here the "password" IS high-entropy
	// random (256 bits), so a fixed public salt is acceptable and standard
	// practice for API keys (no rainbow table can precompute 2^256 keys).
	salt := []byte("kervia-vault-api-key-v1")
	dk := argon2.IDKey([]byte(key), salt, argon2Time, argon2Memory, argon2Threads, 32)
	return fmt.Sprintf("argon2id:v=%d$m=%d,t=%d,p=%d$%x",
		argon2.Version, argon2Memory, argon2Time, argon2Threads, dk)
}

// VerifyAPIKey re-derives the hash and compares in constant time.
func VerifyAPIKey(key, storedHash string) bool {
	computed := HashAPIKey(key)
	// constant-time comparison — length is equal by construction
	var diff byte
	for i := 0; i < len(computed) && i < len(storedHash); i++ {
		diff |= computed[i] ^ storedHash[i]
	}
	return diff == 0 && len(computed) == len(storedHash)
}
