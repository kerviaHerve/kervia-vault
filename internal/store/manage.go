// Store: pro-management operations — vault delete, agent purge,
// secret full update (key + value), agent secret-by-key lookup.
// SPDX-License-Identifier: AGPL-3.0

package store

import (
	"database/sql"
	"errors"
)

// DeleteVault removes a vault and cascades (secrets, versions, grants).
// Refuses if secrets remain — explicit cleanup avoids mass secret loss.
func (s *Store) DeleteVault(id string) error {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM secrets WHERE vault_id = ?`, id).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return errors.New("vault_not_empty")
	}
	res, err := s.db.Exec(`DELETE FROM vaults WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// CountSecretsByVault returns how many secrets a vault holds.
func (s *Store) CountSecretsByVault(vaultID string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM secrets WHERE vault_id = ?`, vaultID).Scan(&n)
	return n, err
}

// PurgeAgent hard-deletes a REVOKED agent (its grants cascade).
// Active agents must be revoked first — two-step safety.
func (s *Store) PurgeAgent(id string) error {
	var revoked sql.NullString
	if err := s.db.QueryRow(`SELECT revoked_at FROM agents WHERE id = ?`, id).Scan(&revoked); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if !revoked.Valid {
		return errors.New("agent_not_revoked")
	}
	_, err := s.db.Exec(`DELETE FROM agents WHERE id = ?`, id)
	return err
}

// UpdateSecretKey renames a secret's key (name) within its vault.
func (s *Store) UpdateSecretKey(id, newKey string) error {
	res, err := s.db.Exec(`UPDATE secrets SET key = ? WHERE id = ?`, newKey, id)
	if err != nil {
		return ErrConflict // UNIQUE(vault_id, key) violation
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// GetSecretByVaultAndKey finds a secret id by vault + key name.
func (s *Store) GetSecretByVaultAndKey(vaultID, key string) (string, error) {
	var id string
	err := s.db.QueryRow(`SELECT id FROM secrets WHERE vault_id = ? AND key = ?`, vaultID, key).Scan(&id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	return id, nil
}