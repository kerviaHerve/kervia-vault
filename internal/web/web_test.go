// Webui tests — XSS regression: malicious names must never reach the
// response as raw HTML.
//
// SPDX-License-Identifier: AGPL-3.0

package web

import (
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

func newXSSServer(t *testing.T) *Server {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "web.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	adminHash, _ := bcrypt.GenerateFromPassword([]byte("x"), bcrypt.MinCost)
	authSvc := auth.New(st, string(adminHash), 100000)
	enc, _ := crypto.NewEncryptorFromHex(strings.Repeat("ab", 32))
	return New(st, authSvc, enc)
}

func TestXSSAgentName(t *testing.T) {
	s := newXSSServer(t)
	// malicious agent name — must be escaped in the page
	full, prefix, hash, _ := crypto.GenerateAPIKey()
	_, _, _, _ = full, prefix, hash, ""
	payload := `<script>alert(1)</script>`
	if _, err := s.store.CreateAgent("xss-1", payload, hash, prefix); err != nil {
		t.Fatalf("seed: %v", err)
	}
	page := s.RenderAgentsForTest()
	if strings.Contains(page, "<script>alert(1)</script>") {
		t.Fatal("XSS: raw script tag reached the page")
	}
	if !strings.Contains(page, "&lt;script&gt;") {
		t.Fatal("name not escaped as expected")
	}
}
