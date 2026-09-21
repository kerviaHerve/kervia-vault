// Store: vaults, grants and secret operations.
// SPDX-License-Identifier: AGPL-3.0

package store

import (
	"database/sql"
	"errors"
	"time"

	"github.com/kerviaHerve/kervia-vault/internal/model"
)

// ---- Vault ----

// CreateVault inserts a new vault.
func (s *Store) CreateVault(id, name string) (*model.Vault, error) {
	ts := now()
	_, err := s.db.Exec(`INSERT INTO vaults (id, name, created_at) VALUES (?, ?, ?)`, id, name, ts)
	if err != nil {
		return nil, ErrConflict
	}
	t, _ := time.Parse(time.RFC3339Nano, ts)
	return &model.Vault{ID: id, Name: name, CreatedAt: t}, nil
}

// GetVaultByName fetches a vault by its unique name.
func (s *Store) GetVaultByName(name string) (*model.Vault, error) {
	row := s.db.QueryRow(`SELECT id, name, created_at FROM vaults WHERE name = ?`, name)
	var v model.Vault
	var ts string
	if err := row.Scan(&v.ID, &v.Name, &ts); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	v.CreatedAt, _ = time.Parse(time.RFC3339Nano, ts)
	return &v, nil
}

// ListVaults returns every vault (webui).
func (s *Store) ListVaults() ([]*model.Vault, error) {
	rows, err := s.db.Query(`SELECT id, name, created_at FROM vaults ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.Vault
	for rows.Next() {
		var v model.Vault
		var ts string
		if err := rows.Scan(&v.ID, &v.Name, &ts); err != nil {
			return nil, err
		}
		v.CreatedAt, _ = time.Parse(time.RFC3339Nano, ts)
		out = append(out, &v)
	}
	return out, rows.Err()
}

// ---- Grant ----

// ListVaultsForAgent returns the vaults an agent has access to.
func (s *Store) ListVaultsForAgent(agentID string) ([]*model.Vault, error) {
	rows, err := s.db.Query(`
		SELECT v.id, v.name, v.created_at
		FROM vaults v
		JOIN grants g ON g.vault_id = v.id
		WHERE g.agent_id = ?
		ORDER BY v.name`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.Vault
	for rows.Next() {
		var v model.Vault
		var ts string
		if err := rows.Scan(&v.ID, &v.Name, &ts); err != nil {
			return nil, err
		}
		v.CreatedAt, _ = time.Parse(time.RFC3339Nano, ts)
		out = append(out, &v)
	}
	return out, rows.Err()
}

// HasGrant reports whether an agent can access a vault (and if write).
func (s *Store) HasGrant(agentID, vaultID string, needWrite bool) (bool, error) {
	q := `SELECT can_write FROM grants WHERE agent_id = ? AND vault_id = ?`
	var canWrite int
	err := s.db.QueryRow(q, agentID, vaultID).Scan(&canWrite)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	if needWrite {
		return canWrite == 1, nil
	}
	return true, nil
}

// AddGrant links an agent to a vault.
func (s *Store) AddGrant(agentID, vaultID string, canWrite bool) error {
	w := 0
	if canWrite {
		w = 1
	}
	_, err := s.db.Exec(`INSERT OR REPLACE INTO grants (agent_id, vault_id, can_write, granted_at) VALUES (?, ?, ?, ?)`,
		agentID, vaultID, w, now())
	return err
}

// RemoveGrant unlinks an agent from a vault.
func (s *Store) RemoveGrant(agentID, vaultID string) error {
	_, err := s.db.Exec(`DELETE FROM grants WHERE agent_id = ? AND vault_id = ?`, agentID, vaultID)
	return err
}

// ListGrants returns every grant (webui matrix).
func (s *Store) ListGrants() ([]*model.Grant, error) {
	rows, err := s.db.Query(`SELECT agent_id, vault_id, can_write, granted_at FROM grants`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.Grant
	for rows.Next() {
		var g model.Grant
		var w int
		var ts string
		if err := rows.Scan(&g.AgentID, &g.VaultID, &w, &ts); err != nil {
			return nil, err
		}
		g.CanWrite = w == 1
		g.GrantedAt, _ = time.Parse(time.RFC3339Nano, ts)
		out = append(out, &g)
	}
	return out, rows.Err()
}
