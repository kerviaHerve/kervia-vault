// Store: coffre attachments — sealed files bound to a coffre item (v1.9.0).
// Zero-knowledge, like everything coffre: Meta and Data are opaque
// AES-256-GCM ciphertext produced in the browser. No method here decrypts
// anything — there is no server-side key. Quotas (2 MiB/file, 5/item) are
// enforced in the API layer; the store is the last line of defense via
// CountByItem before insert.
//
// SPDX-License-Identifier: AGPL-3.0

package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/kerviaHerve/kervia-vault/internal/model"
)

// ErrAttachmentNotFound — id inconnu ou n'appartenant pas à l'item donné.
var ErrAttachmentNotFound = errors.New("store: coffre attachment not found")

// CreateCoffreAttachment persiste les deux blobs scellés d'une pièce jointe.
// L'item parent doit exister (une pièce jointe sans item est un orphelin).
func (s *Store) CreateCoffreAttachment(id, itemID string, meta, data []byte) error {
	var one int
	if err := s.db.QueryRow(`SELECT 1 FROM coffre_items WHERE id = ?`, itemID).Scan(&one); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("store: attach parent check: %w", err)
	}
	_, err := s.db.Exec(`INSERT INTO coffre_attachments (id, item_id, meta, data, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		id, itemID, meta, data, nowRFC())
	return err
}

// ListCoffreAttachments — SANS le blob data (seul le petit meta scellé
// voyage : le client déchiffre {filename, mime, size} pour l'affichage,
// jamais le contenu).
func (s *Store) ListCoffreAttachments(itemID string) ([]*model.CoffreAttachment, error) {
	rows, err := s.db.Query(`SELECT id, item_id, meta, LENGTH(data), created_at
		FROM coffre_attachments WHERE item_id = ? ORDER BY created_at`, itemID)
	if err != nil {
		return nil, fmt.Errorf("store: attach list: %w", err)
	}
	defer func() { _ = rows.Close() }()
	out := []*model.CoffreAttachment{}
	for rows.Next() {
		a := &model.CoffreAttachment{}
		var created string
		if err := rows.Scan(&a.ID, &a.ItemID, &a.Meta, &a.Size, &created); err != nil {
			return nil, err
		}
		a.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetCoffreAttachment — les deux blobs dans leur intégralité (téléchargement).
func (s *Store) GetCoffreAttachment(id string) (*model.CoffreAttachment, error) {
	a := &model.CoffreAttachment{}
	var created string
	err := s.db.QueryRow(`SELECT id, item_id, meta, data, created_at
		FROM coffre_attachments WHERE id = ?`, id).
		Scan(&a.ID, &a.ItemID, &a.Meta, &a.Data, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrAttachmentNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("store: attach get: %w", err)
	}
	a.Size = len(a.Data)
	a.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	return a, nil
}

// DeleteCoffreAttachment — idempotent (l'absence n'est pas une erreur :
// un double clic ne doit jamais échouer bruyamment).
func (s *Store) DeleteCoffreAttachment(id string) error {
	_, err := s.db.Exec(`DELETE FROM coffre_attachments WHERE id = ?`, id)
	return err
}

// CountCoffreAttachments — quota par item (5 max, appliqué dans l'API).
func (s *Store) CountCoffreAttachments(itemID string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM coffre_attachments WHERE item_id = ?`, itemID).Scan(&n)
	return n, err
}

// SweepCoffreTrash : rétention de la corbeille (v1.9.0). Les items en
// corbeille depuis plus de `days` jours sont purgés DÉFINITIVEMENT, et
// leurs pièces jointes avec (jamais d'orphelins — même transaction).
// Appelé au listing : paresseux, best-effort, jamais bloquant pour la
// lecture. deleted_at est une métadonnée serveur — ce sweep ne révèle rien
// et ne déchiffre rien.
func (s *Store) SweepCoffreTrash(days int) (int64, error) {
	if days <= 0 {
		days = 30
	}
	cutoff := time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour).Format(time.RFC3339Nano)
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	// les pièces jointes d'abord : elles référencent les items à purger
	if _, err := tx.Exec(`DELETE FROM coffre_attachments WHERE item_id IN
		(SELECT id FROM coffre_items WHERE deleted_at IS NOT NULL AND deleted_at < ?)`, cutoff); err != nil {
		return 0, err
	}
	res, err := tx.Exec(`DELETE FROM coffre_items WHERE deleted_at IS NOT NULL AND deleted_at < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return n, nil
}
