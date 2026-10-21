// Store: coffre — the personal password manager storage.
// Zero-knowledge by design: only opaque client-encrypted blobs are
// stored here. No method in this file ever decrypts anything — there
// is no server-side key for the coffre. These tables are reachable
// ONLY through the session-guarded admin API, never through the agent
// API (/v1) or MCP.
// SPDX-License-Identifier: AGPL-3.0

package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/kerviaHerve/kervia-vault/internal/model"
)

const coffreSingleRowID = 1 // single-user coffre (v1)

// GetCoffreMeta fetches the coffre header (KDF params, wrapped key).
func (s *Store) GetCoffreMeta() (*model.CoffreMeta, error) {
	row := s.db.QueryRow(`SELECT id, kdf_algo, kdf_params, kdf_salt, wrapped_key, verifier, created_at, updated_at
		FROM coffre_meta WHERE id = ?`, coffreSingleRowID)
	var m model.CoffreMeta
	var created, updated string
	err := row.Scan(&m.ID, &m.KDFAlgo, &m.KDFParams, &m.KDFSalt, &m.WrappedKey, &m.Verifier, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("store: coffre meta: %w", err)
	}
	m.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	m.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return &m, nil
}

// CreateCoffreMeta initialises the coffre header. Single row: a second
// call is a conflict (the webui refuses double initialisation).
func (s *Store) CreateCoffreMeta(algo, params string, salt, wrappedKey, verifier []byte) error {
	ts := now()
	_, err := s.db.Exec(`INSERT INTO coffre_meta (id, kdf_algo, kdf_params, kdf_salt, wrapped_key, verifier, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		coffreSingleRowID, algo, params, salt, wrappedKey, verifier, ts, ts)
	if isUniqueViolation(err) {
		return ErrConflict
	}
	if err != nil {
		return fmt.Errorf("store: coffre create: %w", err)
	}
	return nil
}

// RekeyCoffre replaces the KDF material + wrapped key (master password
// change). The coffre key itself is re-wrapped client-side; the server
// only stores the new opaque envelope.
func (s *Store) RekeyCoffre(algo, params string, salt, wrappedKey, verifier []byte) error {
	res, err := s.db.Exec(`UPDATE coffre_meta
		SET kdf_algo = ?, kdf_params = ?, kdf_salt = ?, wrapped_key = ?, verifier = ?, updated_at = ?
		WHERE id = ?`,
		algo, params, salt, wrappedKey, verifier, now(), coffreSingleRowID)
	if err != nil {
		return fmt.Errorf("store: coffre rekey: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ListCoffreItems returns every item (trash included — the client filters).
func (s *Store) ListCoffreItems() ([]model.CoffreItem, error) {
	rows, err := s.db.Query(`SELECT id, blob, version, created_at, updated_at, deleted_at
		FROM coffre_items ORDER BY updated_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("store: coffre list: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := []model.CoffreItem{}
	for rows.Next() {
		var it model.CoffreItem
		var created, updated string
		var deleted sql.NullString
		if err := rows.Scan(&it.ID, &it.Blob, &it.Version, &created, &updated, &deleted); err != nil {
			return nil, fmt.Errorf("store: coffre scan: %w", err)
		}
		it.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		it.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		if deleted.Valid && deleted.String != "" {
			t, _ := time.Parse(time.RFC3339Nano, deleted.String)
			it.DeletedAt = &t
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

// CreateCoffreItem inserts one opaque blob (v1).
func (s *Store) CreateCoffreItem(id string, blob []byte) (*model.CoffreItem, error) {
	ts := now()
	if _, err := s.db.Exec(`INSERT INTO coffre_items (id, blob, version, created_at, updated_at)
		VALUES (?, ?, 1, ?, ?)`, id, blob, ts, ts); err != nil {
		if isUniqueViolation(err) {
			return nil, ErrConflict
		}
		return nil, fmt.Errorf("store: coffre item create: %w", err)
	}
	t, _ := time.Parse(time.RFC3339Nano, ts)
	return &model.CoffreItem{ID: id, Blob: blob, Version: 1, CreatedAt: t, UpdatedAt: t}, nil
}

// CreateCoffreItems inserts many opaque blobs in ONE transaction
// (import path). All-or-nothing.
func (s *Store) CreateCoffreItems(ids []string, blobs [][]byte) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	ts := now()
	for i := range ids {
		if _, err := tx.Exec(`INSERT INTO coffre_items (id, blob, version, created_at, updated_at)
			VALUES (?, ?, 1, ?, ?)`, ids[i], blobs[i], ts, ts); err != nil {
			_ = tx.Rollback()
			if isUniqueViolation(err) {
				return ErrConflict
			}
			return fmt.Errorf("store: coffre batch: %w", err)
		}
	}
	return tx.Commit()
}

// UpdateCoffreItem replaces the blob with optimistic concurrency: the
// client sends the version it based its edit on; a mismatch means a
// concurrent edit elsewhere and is a conflict, not a silent overwrite.
func (s *Store) UpdateCoffreItem(id string, blob []byte, expectedVersion int) (*model.CoffreItem, error) {
	ts := now()
	res, err := s.db.Exec(`UPDATE coffre_items
		SET blob = ?, version = version + 1, updated_at = ?, deleted_at = NULL
		WHERE id = ? AND version = ?`,
		blob, ts, id, expectedVersion)
	if err != nil {
		return nil, fmt.Errorf("store: coffre item update: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		// distinguish 404 from 409 for the client
		var one int
		err := s.db.QueryRow(`SELECT 1 FROM coffre_items WHERE id = ?`, id).Scan(&one)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, ErrConflict
	}
	return s.GetCoffreItem(id)
}

// GetCoffreItem fetches one item (opaque blob).
func (s *Store) GetCoffreItem(id string) (*model.CoffreItem, error) {
	row := s.db.QueryRow(`SELECT id, blob, version, created_at, updated_at, deleted_at
		FROM coffre_items WHERE id = ?`, id)
	var it model.CoffreItem
	var created, updated string
	var deleted sql.NullString
	if err := row.Scan(&it.ID, &it.Blob, &it.Version, &created, &updated, &deleted); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("store: coffre item get: %w", err)
	}
	it.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	it.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	if deleted.Valid && deleted.String != "" {
		t, _ := time.Parse(time.RFC3339Nano, deleted.String)
		it.DeletedAt = &t
	}
	return &it, nil
}

// SoftDeleteCoffreItem moves an item to the trash.
func (s *Store) SoftDeleteCoffreItem(id string) error {
	res, err := s.db.Exec(`UPDATE coffre_items SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		now(), now(), id)
	if err != nil {
		return fmt.Errorf("store: coffre soft delete: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// RestoreCoffreItem takes an item out of the trash.
func (s *Store) RestoreCoffreItem(id string) error {
	res, err := s.db.Exec(`UPDATE coffre_items SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`,
		now(), id)
	if err != nil {
		return fmt.Errorf("store: coffre restore: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// PurgeCoffreItem hard-deletes one item (no recovery).
func (s *Store) PurgeCoffreItem(id string) error {
	res, err := s.db.Exec(`DELETE FROM coffre_items WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("store: coffre purge item: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// PurgeCoffreTrash hard-deletes every trashed item. Returns the count.
func (s *Store) PurgeCoffreTrash() (int64, error) {
	res, err := s.db.Exec(`DELETE FROM coffre_items WHERE deleted_at IS NOT NULL`)
	if err != nil {
		return 0, fmt.Errorf("store: coffre purge trash: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// DestroyCoffre wipes the whole coffre (meta + items) in one
// transaction. Irreversible — guarded by an explicit confirmation at
// the API layer and audited.
func (s *Store) DestroyCoffre() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM coffre_items`); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("store: coffre destroy items: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM coffre_meta`); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("store: coffre destroy meta: %w", err)
	}
	return tx.Commit()
}

// CountCoffreItems returns (live, trashed) item counts for the header.
func (s *Store) CountCoffreItems() (live int, trashed int, err error) {
	err = s.db.QueryRow(`SELECT
		COALESCE(SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END), 0)
		FROM coffre_items`).Scan(&live, &trashed)
	if err != nil {
		return 0, 0, fmt.Errorf("store: coffre count: %w", err)
	}
	return live, trashed, nil
}