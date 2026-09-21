// Package config loads and validates Kervia-vault configuration.
// Fail-closed: any missing or malformed value prevents startup.
 
// SPDX-License-Identifier: AGPL-3.0

// Package config loads and validates Kervia-vault configuration.
package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

// Errors are sentinel values for startup validation.
var (
	ErrMissingMasterKey  = errors.New("config: KERVIA_VAULT_MASTER_KEY is required (64 hex chars)")
	ErrMissingAdminHash  = errors.New("config: KERVIA_VAULT_ADMIN_HASH is required (bcrypt)")
	ErrInvalidMasterKey  = errors.New("config: KERVIA_VAULT_MASTER_KEY must be 64 hex chars")
)

// Config is the fully validated runtime configuration.
type Config struct {
	ListenAddr  string // http listen address
	DBPath      string // sqlite file path
	MasterKey   string // 64 hex chars — hex, not bytes (crypto parses it)
	AdminHash   string // bcrypt hash of the webui admin password
	RatePerMin  int    // requests/minute per API key
	CertFile    string // optional TLS (usually handled by reverse proxy)
	KeyFile     string
}

// FromEnv builds the config from environment variables.
// Missing critical values return an error: the server refuses to boot.
func FromEnv() (*Config, error) {
	masterKey := strings.TrimSpace(os.Getenv("KERVIA_VAULT_MASTER_KEY"))
	if masterKey == "" {
		return nil, ErrMissingMasterKey
	}
	if len(masterKey) != 64 || !isHex(masterKey) {
		return nil, ErrInvalidMasterKey
	}
	adminHash := strings.TrimSpace(os.Getenv("KERVIA_VAULT_ADMIN_HASH"))
	if adminHash == "" {
		return nil, ErrMissingAdminHash
	}

	cfg := &Config{
		ListenAddr: envOr("KERVIA_VAULT_LISTEN", "127.0.0.1:8321"),
		DBPath:     envOr("KERVIA_VAULT_DB", "/var/lib/kervia-vault/kervia-vault.db"),
		MasterKey:  masterKey,
		AdminHash:  adminHash,
		RatePerMin: envIntOr("KERVIA_VAULT_RATE_PER_MIN", 60),
		CertFile:   os.Getenv("KERVIA_VAULT_TLS_CERT"),
		KeyFile:    os.Getenv("KERVIA_VAULT_TLS_KEY"),
	}
	return cfg, nil
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envIntOr(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	var n int
	if _, err := fmt.Sscanf(v, "%d", &n); err != nil || n <= 0 {
		return def
	}
	return n
}

func isHex(s string) bool {
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') && (c < 'A' || c > 'F') {
			return false
		}
	}
	return true
}
