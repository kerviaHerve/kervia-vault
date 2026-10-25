// XPI override test: the AMO-signed extension dropped in the data dir is
// served at /ui/extension-firefox.xpi in priority over the embedded
// (unsigned) build — installation permanente + mises à jour auto.
// SPDX-License-Identifier: AGPL-3.0

package web

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

// TestSignedXPIOverride: with a signed XPI in the data dir, the webui serves
// exactly that file (bytes, cache) — never a stale embedded copy.
func TestSignedXPIOverride(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "web.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	enc, _ := crypto.NewEncryptorFromHex(strings.Repeat("ab", 32))
	adminHash, _ := bcrypt.GenerateFromPassword([]byte("admin-pw"), bcrypt.MinCost)
	authSvc := auth.New(st, string(adminHash), 100000)

	signed := []byte("PK\x03\x04-signed-by-amo")

	mux := http.NewServeMux()

	// 1. dataDir vide : pas d'override, la requête ne doit PAS rendre
	// le contenu signé (retombe sur l'embarqué/SPA).
	New(st, authSvc, enc, "").Routes(mux)
	ts0 := httptest.NewServer(mux)
	t.Cleanup(ts0.Close)
	res, err := http.Get(ts0.URL + "/ui/extension-firefox.xpi")
	if err != nil {
		t.Fatal(err)
	}
	body0, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(body0) == string(signed) {
		t.Fatal("override servi avec un dataDir vide")
	}

	// 2. override présent : servi à l'identique, sans cache disque.
	mux2 := http.NewServeMux()
	New(st, authSvc, enc, dir).Routes(mux2)
	ts := httptest.NewServer(mux2)
	t.Cleanup(ts.Close)

	if err := os.WriteFile(filepath.Join(dir, extensionXPIName), signed, 0o644); err != nil {
		t.Fatal(err)
	}
	res, err = http.Get(ts.URL + "/ui/extension-firefox.xpi")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()

	if res.StatusCode != 200 {
		t.Fatalf("status = %d", res.StatusCode)
	}
	if string(body) != string(signed) {
		t.Fatalf("override non servi : %d octets reçus", len(body))
	}
	if res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", res.Header.Get("Cache-Control"))
	}
	if ct := res.Header.Get("Content-Type"); ct == "" {
		t.Fatal("Content-Type absent")
	}

	// 3. un autre fichier racine n'est pas intercepté par l'override.
	res, err = http.Get(ts.URL + "/ui/theme-boot.js")
	if err != nil {
		t.Fatal(err)
	}
	b2, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(b2) == string(signed) {
		t.Fatal("override servi pour un chemin non-XPI")
	}
}
