// v1.9.0 — SweepCoffreTrash : la rétention de la corbeille (30 jours).
// Test au niveau STORE car il faut antidater deleted_at (métadonnée serveur)
// pour franchir le seuil — pas de setter public, on passe par la base.
//
// SPDX-License-Identifier: AGPL-3.0

package store

import (
	"path/filepath"
	"testing"
	"time"
)

func TestSweepCoffreTrash(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "sweep.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	// un coffre + 3 items, dont 2 passés en corbeille (antidatés)
	if err := s.CreateCoffreMeta("pbkdf2", `{"iterations":600000}`, []byte("salt"), []byte("wrapped"), []byte("verifier")); err != nil {
		t.Fatalf("meta: %v", err)
	}
	ids := []string{}
	for _, name := range []string{"fresh", "old-1", "old-2"} {
		id := name + "-id"
		if _, err := s.CreateCoffreItem(id, []byte("blob-"+name)); err != nil {
			t.Fatalf("item %s: %v", name, err)
		}
		ids = append(ids, id)
	}
	for _, id := range ids[1:] { // corbeille pour old-1 et old-2
		if err := s.SoftDeleteCoffreItem(id); err != nil {
			t.Fatalf("delete %s: %v", id, err)
		}
		// antidate : deleted_at il y a 31 jours → au-delà du seuil de 30
		old := time.Now().UTC().Add(-31 * 24 * time.Hour).Format(time.RFC3339Nano)
		if _, err := s.db.Exec(`UPDATE coffre_items SET deleted_at = ? WHERE id = ?`, old, id); err != nil {
			t.Fatalf("backdate %s: %v", id, err)
		}
		// une pièce jointe scellée sur chaque item périmé → orphelins à nettoyer
		if err := s.CreateCoffreAttachment(id+"-att", id, []byte("meta"), []byte("data")); err != nil {
			t.Fatalf("attach %s: %v", id, err)
		}
	}
	// une pièce jointe sur l'item vivant — doit survivre
	if err := s.CreateCoffreAttachment(ids[0]+"-att", ids[0], []byte("meta"), []byte("data")); err != nil {
		t.Fatalf("attach fresh: %v", err)
	}

	n, err := s.SweepCoffreTrash(30)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 2 {
		t.Fatalf("swept %d items, want 2", n)
	}

	// l'item vivant et SA pièce jointe sont intacts
	if _, err := s.GetCoffreItem(ids[0]); err != nil {
		t.Fatalf("fresh item must survive: %v", err)
	}
	if atts, err := s.ListCoffreAttachments(ids[0]); err != nil || len(atts) != 1 {
		t.Fatalf("fresh attachment must survive: %v %d", err, len(atts))
	}
	// les pièces jointes des items purgés sont parties (pas d'orphelins)
	for _, id := range ids[1:] {
		if _, err := s.GetCoffreAttachment(id + "-att"); err == nil {
			t.Fatalf("attachment of purged item %s must be gone", id)
		}
		if _, err := s.GetCoffreItem(id); err == nil {
			t.Fatalf("purged item %s must be gone", id)
		}
	}

	// resweep : idempotent
	if n, err := s.SweepCoffreTrash(30); err != nil || n != 0 {
		t.Fatalf("re-sweep must be a no-op: %d %v", n, err)
	}
}
