// Store: extension_token — l'unique token d'accès de l'extension
// navigateur au coffre (GET /ext/coffre). Seul le HASH Argon2id est
// stocké ; régénérer écrase l'ancien token (un seul à la fois).
// SPDX-License-Identifier: AGPL-3.0

package store

import (
	"database/sql"
	"errors"
	"fmt"
)

// ExtensionToken holds the (hashed) browser-extension token row.
type ExtensionToken struct {
	TokenHash  string
	CreatedAt  string
	LastUsedAt string
}

// SetExtensionToken stores the hash of a freshly generated token,
// replacing any previous one (single-row design, id=1).
func (s *Store) SetExtensionToken(hash string) error {
	ts := now()
	_, err := s.db.Exec(`INSERT INTO extension_token (id, token_hash, created_at, last_used_at)
		VALUES (1, ?, ?, '')
		ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash,
			created_at = excluded.created_at, last_used_at = ''`,
		hash, ts)
	if err != nil {
		return fmt.Errorf("store: extension token set: %w", err)
	}
	return nil
}

// GetExtensionToken fetches the stored hash (ErrNotFound if none).
func (s *Store) GetExtensionToken() (*ExtensionToken, error) {
	row := s.db.QueryRow(`SELECT token_hash, created_at, last_used_at FROM extension_token WHERE id = 1`)
	var t ExtensionToken
	err := row.Scan(&t.TokenHash, &t.CreatedAt, &t.LastUsedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("store: extension token get: %w", err)
	}
	return &t, nil
}

// TouchExtensionToken stamps last_used_at (best-effort, non bloquant :
// un échec d'horodatage ne refuse jamais l'accès).
func (s *Store) TouchExtensionToken() {
	_, _ = s.db.Exec(`UPDATE extension_token SET last_used_at = ? WHERE id = 1`, now())
}

// RevokeExtensionToken deletes the token row.
func (s *Store) RevokeExtensionToken() error {
	_, err := s.db.Exec(`DELETE FROM extension_token WHERE id = 1`)
	if err != nil {
		return fmt.Errorf("store: extension token revoke: %w", err)
	}
	return nil
}