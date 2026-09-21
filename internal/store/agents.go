// Store: agents CRUD.
// SPDX-License-Identifier: AGPL-3.0

// Package store implements the SQLite persistence layer.
package store

import (
	"database/sql"
	"errors"
	"time"

	"github.com/kerviaHerve/kervia-vault/internal/model"
)

// CreateAgent stores a new agent. keyHash is the Argon2id hash — the
// plaintext key NEVER transits here.
func (s *Store) CreateAgent(id, name, keyHash, keyPrefix string) (*model.Agent, error) {
	ts := now()
	_, err := s.db.Exec(`INSERT INTO agents (id, name, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?)`,
		id, name, keyHash, keyPrefix, ts)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrConflict
		}
		// modernc sqlite returns "constraint failed" for UNIQUE violations
		return nil, ErrConflict
	}
	t, _ := time.Parse(time.RFC3339Nano, ts)
	return &model.Agent{ID: id, Name: name, KeyPrefix: keyPrefix, CreatedAt: t}, nil
}

// GetAgentByKeyHash looks up an agent by its stored key hash (login path).
func (s *Store) GetAgentByKeyHash(keyHash string) (*model.Agent, error) {
	row := s.db.QueryRow(`SELECT id, name, key_prefix, created_at, revoked_at, last_used
		FROM agents WHERE key_hash = ?`, keyHash)
	return scanAgent(row)
}

// ListAgentsByKeyPrefix narrows the login lookup by prefix before hashing —
// only used when the hash computation is expensive (Argon2id is, so this
// is the primary lookup: O(prefix matches) then constant-time verify).
func (s *Store) ListAgentsByKeyPrefix(prefix string) ([]*model.Agent, error) {
	rows, err := s.db.Query(`SELECT id, name, key_prefix, created_at, revoked_at, last_used
		FROM agents WHERE key_prefix = ? AND revoked_at IS NULL`, prefix)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*model.Agent
	for rows.Next() {
		a, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetAgent fetches an agent by ID.
func (s *Store) GetAgent(id string) (*model.Agent, error) {
	row := s.db.QueryRow(`SELECT id, name, key_prefix, created_at, revoked_at, last_used
		FROM agents WHERE id = ?`, id)
	return scanAgent(row)
}

// ListAgents returns all agents (webui).
func (s *Store) ListAgents() ([]*model.Agent, error) {
	rows, err := s.db.Query(`SELECT id, name, key_prefix, created_at, revoked_at, last_used FROM agents ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*model.Agent
	for rows.Next() {
		a, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// RevokeAgent marks an agent as revoked (soft, audit-friendly).
func (s *Store) RevokeAgent(id string) error {
	res, err := s.db.Exec(`UPDATE agents SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, now(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// TouchAgentLastUsed updates last_used (non-critical: error swallowed by caller).
func (s *Store) TouchAgentLastUsed(id string) {
	_, _ = s.db.Exec(`UPDATE agents SET last_used = ? WHERE id = ?`, now(), id)
}

func scanAgent(row interface{ Scan(...any) error }) (*model.Agent, error) {
	var a model.Agent
	var created, revoked, lastUsed sql.NullString
	if err := row.Scan(&a.ID, &a.Name, &a.KeyPrefix, &created, &revoked, &lastUsed); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	a.CreatedAt, _ = time.Parse(time.RFC3339Nano, created.String)
	if revoked.Valid {
		t, _ := time.Parse(time.RFC3339Nano, revoked.String)
		a.RevokedAt = &t
	}
	if lastUsed.Valid {
		t, _ := time.Parse(time.RFC3339Nano, lastUsed.String)
		a.LastUsed = &t
	}
	return &a, nil
}
// GetAgentForKeyVerify returns the stored key hash for a full verification.
// The hash is only used in memory — never logged, never serialized.
func (s *Store) GetAgentForKeyVerify(id string) (string, error) {
	var keyHash string
	err := s.db.QueryRow(`SELECT key_hash FROM agents WHERE id = ? AND revoked_at IS NULL`, id).Scan(&keyHash)
	return keyHash, err
}
