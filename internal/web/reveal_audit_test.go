// Sentinel fix test: the webui reveal leaves an audit trace (SPEC: audit
// append-only per action — a decrypted read is an action).
// SPDX-License-Identifier: AGPL-3.0

package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

// TestRevealIsAudited: after an admin reveal, the audit trail contains a
// read entry for that secret id.
func TestRevealIsAudited(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "web.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	enc, _ := crypto.NewEncryptorFromHex(strings.Repeat("ab", 32))

	adminHash, _ := bcrypt.GenerateFromPassword([]byte("admin-pw"), bcrypt.MinCost)
	authSvc := auth.New(st, string(adminHash), 100000)
	srv := New(st, authSvc, enc, dir)

	// a vault + a secret
	v, _ := st.CreateVault("vault-web-1", "v-web")
	nonce, ct, _ := enc.Encrypt([]byte(`{"api_key":"sekrit"}`))
	sec, err := st.CreateSecret("sec-web-1", v.ID, "k-web", "api-key", nonce, ct, "ver-web-1", "admin")
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}

	// wire the reveal endpoint like main.go does
	mux := http.NewServeMux()
	srv.AttachAdmin(mux)

	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	res, err := http.Get(ts.URL + "/admin/secrets/reveal?id=" + sec.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("reveal = %d", res.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["value"] != "{\n  \"api_key\": \"sekrit\"\n}" {
		t.Fatalf("unexpected reveal payload: %v", body["value"])
	}

	// the audit trail MUST contain the read
	entries, err := st.ListAudit(50, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range entries {
		if e.Action == "read" && e.Resource == "secret/"+sec.ID {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("reveal left NO audit trace — the read is repudiable")
	}
}
