// Ephemeral one-time share links: the store side.
//
// Security model: the 32-byte token is returned ONCE to the admin and never
// persisted — only its SHA-256 lives here. ConsumeShare is the only
// transition and it is atomic: consumed_at is set under a
// `WHERE consumed_at IS NULL AND expires_at > now` guard, and the rowcount
// decides — two concurrent viewers of the same link, only one wins.
//
// SPDX-License-Identifier: AGPL-3.0

package store

import (
	"database/sql"
	"errors"
	"time"
)

// ErrShareGone : lien consommé, expiré ou inconnu — même réponse pour tous,
// l'énumération de tokens n'apprend rien.
var ErrShareGone = errors.New("store: share consumed, expired or unknown")

func nowRFC() string { return time.Now().UTC().Format(time.RFC3339Nano) }

// CreateShare persiste le hash du token (le token lui-même ne transite JAMAIS
// en base). ttl borné par l'appelant.
func (s *Store) CreateShare(id, tokenHash, secretID, createdBy string, expiresAt time.Time) error {
	_, err := s.db.Exec(`INSERT INTO shares (id, token_hash, secret_id, created_by, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		id, tokenHash, secretID, createdBy,
		expiresAt.UTC().Format(time.RFC3339Nano), nowRFC())
	if err != nil {
		return err
	}
	// sweep paresseux : on nettoie en passant (les créations sont rares)
	_, _ = s.db.Exec(`DELETE FROM shares WHERE expires_at < ?`, nowRFC())
	return nil
}

// ConsumeShare brûle le lien et retourne le secret concerné. One-time par
// construction : la clause WHERE consumed_at IS NULL rend la course sûre.
func (s *Store) ConsumeShare(tokenHash string) (secretID string, err error) {
	res, err := s.db.Exec(`UPDATE shares SET consumed_at = ?
		WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
		nowRFC(), tokenHash, nowRFC())
	if err != nil {
		return "", err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return "", ErrShareGone
	}
	err = s.db.QueryRow(`SELECT secret_id FROM shares WHERE token_hash = ?`, tokenHash).Scan(&secretID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrShareGone
	}
	return secretID, err
}

// GetVaultNameByID : libellé du vault pour la page de partage (lecture seule).
func (s *Store) GetVaultNameByID(id string) (string, error) {
	var name string
	err := s.db.QueryRow(`SELECT name FROM vaults WHERE id = ?`, id).Scan(&name)
	return name, err
}