// Race regression: concurrent password change + checks must be safe.
// SPDX-License-Identifier: AGPL-3.0

package auth

import (
	"path/filepath"
	"sync"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/kerviaHerve/kervia-vault/internal/store"
)

func TestAdminPasswordRace(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "race.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	defer st.Close()
	adminHash, _ := bcrypt.GenerateFromPassword([]byte("start-pw"), bcrypt.MinCost)
	svc := New(st, string(adminHash), 100000)
	svc.SetHashPath(filepath.Join(t.TempDir(), "hash"))

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(2)
		go func(i int) { defer wg.Done()
			pw := "changed-" + string(rune('a'+i))
			for j := 0; j < 20; j++ {
				_ = svc.SetAdminPassword(pw + "xxxxxxxxxxxx")
			}
		}(i)
		go func() { defer wg.Done()
			for j := 0; j < 20; j++ {
				svc.CheckAdmin("whatever")
			}
		}()
	}
	wg.Wait()
}
