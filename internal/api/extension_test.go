// Extension token + /ext/coffre surface tests (v1.8.0).
// Lifecycle: create → status → use → revoke → refused. Isolation:
// the token grants NOTHING but the encrypted coffre blobs — no admin
// surface, no /v1 (agent) surface, and an agent API key is refused.
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func TestExtensionTokenLifecycle(t *testing.T) {
	env, _, _ := newTestEnv(t)

	// no token yet → /ext/coffre refuses
	res := env.do("GET", "/ext/coffre", nil, "")
	if res.StatusCode != 401 {
		t.Fatalf("sans token: attendu 401, reçu %d", res.StatusCode)
	}

	// an agent API key is NOT an extension token (isolation /v1 vs /ext)
	agentKey := env.createAgent("ext-test-agent")
	res = env.do("GET", "/ext/coffre", nil, agentKey)
	if res.StatusCode != 401 {
		t.Fatalf("clé agent sur /ext: attendu 401, reçu %d", res.StatusCode)
	}

	// create (session-guarded route)
	res = env.postJSON("/admin/extension/token", map[string]string{})
	if res.StatusCode != 201 {
		t.Fatalf("création: attendu 201, reçu %d", res.StatusCode)
	}
	var created struct{ Token string }
	b, _ := io.ReadAll(res.Body)
	if err := json.Unmarshal(b, &created); err != nil || created.Token == "" {
		t.Fatalf("création: token absent de la réponse (%s)", b)
	}
	if !strings.HasPrefix(created.Token, "kvext_") || len(created.Token) != len("kvext_")+64 {
		t.Fatalf("création: format token invalide (%d chars)", len(created.Token))
	}

	// status never leaks the token
	res = env.do("GET", "/admin/extension/token", nil, "")
	b, _ = io.ReadAll(res.Body)
	if res.StatusCode != 200 || strings.Contains(string(b), created.Token) {
		t.Fatalf("statut: fuite du token ou code %d (%s)", res.StatusCode, b)
	}

	// the token authenticates on /ext/coffre — 404 coffre_not_created on
	// a fresh DB (proof the auth SUCCEEDED, the coffre simply does not exist)
	res = env.do("GET", "/ext/coffre", nil, created.Token)
	b, _ = io.ReadAll(res.Body)
	if res.StatusCode != 404 || !strings.Contains(string(b), "coffre_not_created") {
		t.Fatalf("token valide: attendu 404 coffre_not_created, reçu %d %s", res.StatusCode, b)
	}

	// unknown token refused
	res = env.do("GET", "/ext/coffre", nil, "kvext_"+strings.Repeat("0", 64))
	if res.StatusCode != 401 {
		t.Fatalf("token inconnu: attendu 401, reçu %d", res.StatusCode)
	}

	// the extension token grants NO admin surface
	res = env.do("GET", "/admin/secrets", nil, created.Token)
	if res.StatusCode != 401 {
		t.Fatalf("token extension sur /admin: attendu 401, reçu %d", res.StatusCode)
	}

	// revoke → the minted token stops working
	res = env.do("DELETE", "/admin/extension/token", nil, "")
	if res.StatusCode != 200 {
		t.Fatalf("révocation: reçu %d", res.StatusCode)
	}
	res = env.do("GET", "/ext/coffre", nil, created.Token)
	if res.StatusCode != 401 {
		t.Fatalf("token révoqué: attendu 401, reçu %d", res.StatusCode)
	}
}

// TestExtCoffreServesCoffreOnceCreated: with a coffre + one item, the
// token returns the envelope + the opaque blobs in ONE round trip —
// and never decrypts anything.
func TestExtCoffreServesCoffreOnceCreated(t *testing.T) {
	env, _, _ := newTestEnv(t)

	// coffre envelope + one item (opaque blobs, as the webui would)
	if err := env.store.CreateCoffreMeta("pbkdf2", `{"iterations":600000}`, []byte("0123456789abcdef"), []byte("wrapped-blob-0123"), []byte("verifier-blob-0123")); err != nil {
		t.Fatal(err)
	}
	if err := env.store.CreateCoffreItems([]string{"i-1"}, [][]byte{[]byte("blob-1")}); err != nil {
		t.Fatal(err)
	}

	res := env.postJSON("/admin/extension/token", map[string]string{})
	var created struct{ Token string }
	b, _ := io.ReadAll(res.Body)
	json.Unmarshal(b, &created)

	res = env.do("GET", "/ext/coffre", nil, created.Token)
	b, _ = io.ReadAll(res.Body)
	if res.StatusCode != 200 {
		t.Fatalf("GET /ext/coffre: %d %s", res.StatusCode, b)
	}
	var pack struct {
		Envelope struct {
			KDFAlgo  string `json:"kdf_algo"`
			KDFSalt  []byte `json:"kdf_salt_b64"`
			WrappedK []byte `json:"wrapped_key_b64"`
		} `json:"envelope"`
		Items []struct {
			ID      string `json:"id"`
			Blob    []byte `json:"blob_b64"`
			Version int    `json:"version"`
		} `json:"items"`
	}
	if err := json.Unmarshal(b, &pack); err != nil {
		t.Fatal(err)
	}
	if pack.Envelope.KDFAlgo != "pbkdf2" || len(pack.Items) != 1 || pack.Items[0].Version != 1 {
		t.Fatalf("forme invalide: %+v", pack)
	}
}