// Store: secrets — create/read/update/delete with immutable versioning.
// Ciphertext/nonce are opaque blobs here; the crypto layer owns them.
// SPDX-License-Identifier: AGPL-3.0

package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/kerviaHerve/kervia-vault/internal/model"
)

// CreateSecret inserts a secret (v1) and its first historical version
// in one transaction.
func (s *Store) CreateSecret(id, vaultID, key, tmpl string, nonce, ciphertext []byte, versionID, createdBy string) (*model.Secret, error) {
	ts := now()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(`INSERT INTO secrets (id, vault_id, key, template, nonce, ciphertext, version, created_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
		id, vaultID, key, tmpl, nonce, ciphertext, createdBy, ts, ts)
	if err != nil {
		_ = tx.Rollback()
		if isUniqueViolation(err) {
			return nil, ErrConflict // UNIQUE(vault_id, key)
		}
		return nil, fmt.Errorf("store: create secret: %w", err)
	}
	_, err = tx.Exec(`INSERT INTO secret_versions (id, secret_id, version, nonce, ciphertext, written_by, written_at)
		VALUES (?, ?, 1, ?, ?, ?, ?)`, versionID, id, nonce, ciphertext, createdBy, ts)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	t, _ := time.Parse(time.RFC3339Nano, ts)
	return &model.Secret{ID: id, VaultID: vaultID, Key: key, Template: tmpl, Version: 1,
		CreatedBy: createdBy, CreatedAt: t, UpdatedAt: t}, nil
}

// GetSecretByID fetches a secret (encrypted) by its ID.
func (s *Store) GetSecretByID(id string) (*model.Secret, []byte, []byte, error) {
	row := s.db.QueryRow(`SELECT id, vault_id, key, template, nonce, ciphertext, version, created_by, created_at, updated_at
		FROM secrets WHERE id = ?`, id)
	return scanSecret(row)
}

// GetSecretByKey fetches a secret (encrypted) by vault + key name.
func (s *Store) GetSecretByKey(vaultID, key string) (*model.Secret, []byte, []byte, error) {
	row := s.db.QueryRow(`SELECT id, vault_id, key, template, nonce, ciphertext, version, created_by, created_at, updated_at
		FROM secrets WHERE vault_id = ? AND key = ?`, vaultID, key)
	return scanSecret(row)
}

// ListSecretsByVault lists metadata only (no values) for a vault.
func (s *Store) ListSecretsByVault(vaultID string) ([]*model.Secret, error) {
	rows, err := s.db.Query(`SELECT id, vault_id, key, template, version, created_by, created_at, updated_at
		FROM secrets WHERE vault_id = ? ORDER BY key`, vaultID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.Secret
	for rows.Next() {
		var sec model.Secret
		var c, u string
		var tmpl sql.NullString
		if err := rows.Scan(&sec.ID, &sec.VaultID, &sec.Key, &tmpl, &sec.Version, &sec.CreatedBy, &c, &u); err != nil {
			return nil, err
		}
		sec.Template = tmpl.String
		sec.CreatedAt, _ = time.Parse(time.RFC3339Nano, c)
		sec.UpdatedAt, _ = time.Parse(time.RFC3339Nano, u)
		out = append(out, &sec)
	}
	return out, rows.Err()
}

// UpdateSecretValue writes a new version transactionally:
// bump version in secrets, append to secret_versions.
func (s *Store) UpdateSecretValue(id string, nonce, ciphertext []byte, writtenBy string, newVersionID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	var current int
	err = tx.QueryRow(`SELECT version FROM secrets WHERE id = ?`, id).Scan(&current)
	if err != nil {
		_ = tx.Rollback()
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	ts := now()
	res, err := tx.Exec(`UPDATE secrets SET nonce = ?, ciphertext = ?, version = version + 1, updated_at = ? WHERE id = ?`,
		nonce, ciphertext, ts, id)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		_ = tx.Rollback()
		return ErrNotFound
	}
	_, err = tx.Exec(`INSERT INTO secret_versions (id, secret_id, version, nonce, ciphertext, written_by, written_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, newVersionID, id, current+1, nonce, ciphertext, writtenBy, ts)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// DeleteSecret removes a secret and its versions (audit keeps the trace).
func (s *Store) DeleteSecret(id string) error {
	res, err := s.db.Exec(`DELETE FROM secrets WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ListVersions returns the version history of a secret (metadata only).
func (s *Store) ListVersions(secretID string) ([]*model.SecretVersion, error) {
	rows, err := s.db.Query(`SELECT id, secret_id, version, written_by, written_at
		FROM secret_versions WHERE secret_id = ? ORDER BY version DESC`, secretID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.SecretVersion
	for rows.Next() {
		var v model.SecretVersion
		var ts string
		if err := rows.Scan(&v.ID, &v.SecretID, &v.Version, &v.WrittenBy, &ts); err != nil {
			return nil, err
		}
		v.WrittenAt, _ = time.Parse(time.RFC3339Nano, ts)
		out = append(out, &v)
	}
	return out, rows.Err()
}

// isUniqueViolation detects modernc/sqlite UNIQUE constraint failures.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "UNIQUE constraint failed")
}

func scanSecret(row *sql.Row) (*model.Secret, []byte, []byte, error) {
	var sec model.Secret
	var nonce, ct []byte
	var c, u string
	var tmpl sql.NullString
	err := row.Scan(&sec.ID, &sec.VaultID, &sec.Key, &tmpl, &nonce, &ct, &sec.Version, &sec.CreatedBy, &c, &u)
	sec.Template = tmpl.String
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, nil, ErrNotFound
		}
		return nil, nil, nil, err
	}
	sec.CreatedAt, _ = time.Parse(time.RFC3339Nano, c)
	sec.UpdatedAt, _ = time.Parse(time.RFC3339Nano, u)
	return &sec, nonce, ct, nil
}
