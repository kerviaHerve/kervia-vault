// Coffre integration tests. These verify the CORE invariant end-to-end:
// the coffre (personal password manager) is invisible to agents — no
// /v1 surface, session-guarded only, nothing in MCP — while the admin
// webui can manage opaque blobs; and the server NEVER needs (or logs)
// plaintext to do so.
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kerviaHerve/kervia-vault/internal/model"
)

// validEnvelope builds a shape-valid zero-knowledge envelope. The
// content is irrelevant to the server (it is ciphertext for the user's
// master password) — only the shape is checked.
func validEnvelope() map[string]any {
	return map[string]any{
		"kdf_algo":         "pbkdf2",
		"kdf_params":       `{"iterations":600000}`,
		"kdf_salt_b64":     base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0xA1}, 16)),
		"wrapped_key_b64":  base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0xB2}, 60)),
		"verifier_b64":     base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0xC3}, 48)),
	}
}

func decode(t *testing.T, res *http.Response) map[string]any {
	t.Helper()
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return out
}

// TestCoffreInvisibleToAgents: THE invariant. A valid, granted agent
// key must not reach the coffre through any surface.
func TestCoffreInvisibleToAgents(t *testing.T) {
	env, ritaKey, roKey := newTestEnv(t)

	// agent API key against the admin coffre routes → rejected by the
	// session middleware (a Bearer key is not a session cookie).
	res := env.do("GET", "/admin/coffre", nil, ritaKey)
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("agent key on /admin/coffre: %d, want 401", res.StatusCode)
	}

	// no coffre surface in the agent mux, for both agents
	for _, key := range []string{ritaKey, roKey} {
		for _, p := range []string{"/v1/coffre", "/v1/coffre/items", "/v1/coffre/secrets"} {
			res := env.do("GET", p, nil, key)
			res.Body.Close()
			if res.StatusCode != http.StatusNotFound {
				t.Fatalf("agent GET %s: %d, want 404 (no agent surface)", p, res.StatusCode)
			}
		}
		res := env.do("POST", "/v1/coffre/items", map[string]any{"blob_b64": base64.StdEncoding.EncodeToString([]byte("x"))}, key)
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("agent POST /v1/coffre/items: %d, want 404", res.StatusCode)
		}
	}
}

// TestCoffreSessionGuarded: unauthenticated browsers get 401 too.
func TestCoffreSessionGuarded(t *testing.T) {
	env, _, _ := newTestEnv(t)
	res, err := http.Get(env.srv.URL + "/admin/coffre/items")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous /admin/coffre/items: %d, want 401", res.StatusCode)
	}
}

// TestCoffreLifecycle: the full admin flow — create envelope, items,
// optimistic concurrency, trash, restore, purge, rekey, destroy.
func TestCoffreLifecycle(t *testing.T) {
	env, _, _ := newTestEnv(t)

	// not created yet → 404 with a dedicated code (webui shows setup)
	res := env.do("GET", "/admin/coffre", nil, "")
	if res.StatusCode != 404 {
		t.Fatalf("fresh coffre header: %d, want 404", res.StatusCode)
	}
	body := decode(t, res)
	if body["error"] != "coffre_not_created" {
		t.Fatalf("error code: %v", body["error"])
	}

	// create → 201, double create → 409
	res = env.postJSON("/admin/coffre", validEnvelope())
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("create coffre: %d", res.StatusCode)
	}
	res = env.postJSON("/admin/coffre", validEnvelope())
	res.Body.Close()
	if res.StatusCode != 409 {
		t.Fatalf("double create: %d, want 409", res.StatusCode)
	}

	// header round-trips the envelope + counts
	res = env.do("GET", "/admin/coffre", nil, "")
	h := decode(t, res)
	if res.StatusCode != 200 || h["kdf_algo"] != "pbkdf2" {
		t.Fatalf("header: %d %v", res.StatusCode, h)
	}
	if h["item_count"] != float64(0) || h["trash_count"] != float64(0) {
		t.Fatalf("fresh counts: %v", h)
	}

	// create an item → server-assigned id, version 1, blob opaque
	blob := base64.StdEncoding.EncodeToString([]byte("e2e-blob-v1"))
	res = env.postJSON("/admin/coffre/items", map[string]string{"blob_b64": blob})
	if res.StatusCode != 201 {
		t.Fatalf("create item: %d", res.StatusCode)
	}
	item := decode(t, res)
	id, _ := item["id"].(string)
	if id == "" || item["version"] != float64(1) {
		t.Fatalf("created item: %v", item)
	}

	// list → the blob comes back untouched
	res = env.do("GET", "/admin/coffre/items", nil, "")
	var items []map[string]any
	defer res.Body.Close()
	_ = json.NewDecoder(res.Body).Decode(&items)
	if len(items) != 1 || items[0]["blob_b64"] != blob {
		t.Fatalf("list: %v", items)
	}

	// optimistic concurrency: right version → 200 v2, stale → 409
	res = env.do("PATCH", "/admin/coffre/items/"+id, map[string]any{
		"blob_b64": base64.StdEncoding.EncodeToString([]byte("e2e-blob-v2")),
		"expected_version": 1,
	}, "")
	updated := decode(t, res)
	if res.StatusCode != 200 || updated["version"] != float64(2) {
		t.Fatalf("update: %d %v", res.StatusCode, updated)
	}
	res = env.do("PATCH", "/admin/coffre/items/"+id, map[string]any{
		"blob_b64": blob, "expected_version": 1,
	}, "")
	res.Body.Close()
	if res.StatusCode != 409 {
		t.Fatalf("stale update: %d, want 409", res.StatusCode)
	}

	// counts after one live item
	res = env.do("GET", "/admin/coffre", nil, "")
	h = decode(t, res)
	if h["item_count"] != float64(1) {
		t.Fatalf("live count: %v", h)
	}

	// trash flow: delete → counts, restore, delete, purge trash
	res = env.do("DELETE", "/admin/coffre/items/"+id, nil, "")
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("soft delete: %d", res.StatusCode)
	}
	res = env.do("GET", "/admin/coffre", nil, "")
	h = decode(t, res)
	if h["item_count"] != float64(0) || h["trash_count"] != float64(1) {
		t.Fatalf("trashed counts: %v", h)
	}
	res = env.postJSON("/admin/coffre/items/"+id+"/restore", nil)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("restore: %d", res.StatusCode)
	}
	res = env.do("DELETE", "/admin/coffre/items/"+id, nil, "")
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("re-delete: %d", res.StatusCode)
	}
	res = env.postJSON("/admin/coffre/trash/purge", nil)
	purged := decode(t, res)
	if res.StatusCode != 200 || purged["purged"] != float64(1) {
		t.Fatalf("trash purge: %d %v", res.StatusCode, purged)
	}

	// batch import (Bitwarden) — 2 items in one transaction
	res = env.postJSON("/admin/coffre/items/batch", map[string]any{"items": []map[string]string{
		{"blob_b64": blob}, {"blob_b64": blob},
	}})
	imported := decode(t, res)
	if res.StatusCode != 201 || imported["created"] != float64(2) {
		t.Fatalf("batch: %d %v", res.StatusCode, imported)
	}

	// unknown item → 404, oversized blob → 413
	res = env.do("PATCH", "/admin/coffre/items/nope", map[string]any{"blob_b64": blob, "expected_version": 1}, "")
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatalf("update unknown: %d, want 404", res.StatusCode)
	}
	res = env.postJSON("/admin/coffre/items", map[string]string{
		"blob_b64": base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x11}, 128<<10+1)),
	})
	res.Body.Close()
	if res.StatusCode != 413 {
		t.Fatalf("oversized blob: %d, want 413", res.StatusCode)
	}

	// rekey: new envelope (master password change) → 200, visible in header
	env2 := validEnvelope()
	env2["kdf_salt_b64"] = base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x9D}, 16))
	res = env.postJSON("/admin/coffre/rekey", env2)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("rekey: %d", res.StatusCode)
	}
	res = env.do("GET", "/admin/coffre", nil, "")
	h = decode(t, res)
	if h["kdf_salt_b64"] != env2["kdf_salt_b64"] {
		t.Fatalf("rekey not applied: %v", h["kdf_salt_b64"])
	}

	// destroy: typed confirmation required, then everything is gone
	res = env.do("DELETE", "/admin/coffre", map[string]string{"confirm": "please"}, "")
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatalf("destroy without confirm: %d, want 400", res.StatusCode)
	}
	res = env.do("DELETE", "/admin/coffre", map[string]string{"confirm": "DESTROY"}, "")
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("destroy: %d", res.StatusCode)
	}
	res = env.do("GET", "/admin/coffre", nil, "")
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatalf("destroyed coffre header: %d, want 404", res.StatusCode)
	}
}

// TestCoffreValidation: envelope shape errors get precise codes.
func TestCoffreValidation(t *testing.T) {
	env, _, _ := newTestEnv(t)

	cases := []struct {
		name   string
		mutate func(e map[string]any)
		code   string
	}{
		{"bad algo", func(e map[string]any) { e["kdf_algo"] = "rot13" }, "unsupported_kdf"},
		{"salt too short", func(e map[string]any) {
			e["kdf_salt_b64"] = base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 8))
		}, "invalid_kdf_salt"},
		{"empty wrapped key", func(e map[string]any) { e["wrapped_key_b64"] = "" }, "invalid_wrapped_key"},
		{"empty verifier", func(e map[string]any) { e["verifier_b64"] = "" }, "invalid_verifier"},
	}
	for _, tc := range cases {
		e := validEnvelope()
		tc.mutate(e)
		res := env.postJSON("/admin/coffre", e)
		body := decode(t, res)
		if res.StatusCode != 400 || body["error"] != tc.code {
			t.Fatalf("%s: %d %v, want 400 %s", tc.name, res.StatusCode, body["error"], tc.code)
		}
	}

	// batch over the limit → 413
	items := make([]map[string]string, 501)
	for i := range items {
		items[i] = map[string]string{"blob_b64": base64.StdEncoding.EncodeToString([]byte("x"))}
	}
	res := env.postJSON("/admin/coffre/items/batch", map[string]any{"items": items})
	res.Body.Close()
	if res.StatusCode != 413 {
		t.Fatalf("oversized batch: %d, want 413", res.StatusCode)
	}
}

// TestCoffreAuditNeverLeaksContent: audit rows record actions and
// opaque IDs only — the blob content of an item must never appear in
// any audit field, even by accident.
func TestCoffreAuditNeverLeaksContent(t *testing.T) {
	env, _, _ := newTestEnv(t)

	marker := "plaintext-should-never-appear-anywhere"
	res := env.postJSON("/admin/coffre", validEnvelope())
	res.Body.Close()
	res = env.postJSON("/admin/coffre/items", map[string]string{
		"blob_b64": base64.StdEncoding.EncodeToString([]byte(marker)),
	})
	res.Body.Close()
	res = env.do("GET", "/admin/coffre/items", nil, "")
	res.Body.Close()

	entries, err := env.store.ListAudit(500, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.Contains(e.Resource, marker) || strings.Contains(e.Detail, marker) {
			t.Fatalf("audit leaked coffre content: action=%s resource=%q detail=%q",
				e.Action, e.Resource, e.Detail)
		}
	}
	// sanity: the coffre actions ARE audited
	seen := map[string]bool{}
	for _, e := range entries {
		seen[e.Action] = true
	}
	for _, want := range []string{model.AuditCoffreCreate, model.AuditCoffreItemCreate} {
		if !seen[want] {
			t.Fatalf("missing audit action %q (got %v)", want, seen)
		}
	}
}

// TestNoCoffreInAgentSurface: a source-level tripwire — the agent API
// and MCP files must never reference the coffre. If someone adds a
// coffre tool to MCP or a /v1 coffre route by mistake, this fails.
func TestNoCoffreInAgentSurface(t *testing.T) {
	files := []string{
		"agents.go", // agent endpoint handlers (same package)
		"../mcp/mcp.go",
		"../mcp/helpers.go",
		"../mcp/transport.go",
	}
	for _, f := range files {
		data, err := os.ReadFile(filepath.Join(f))
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		if strings.Contains(strings.ToLower(string(data)), "coffre") {
			t.Fatalf("%s references the coffre — the coffre must stay invisible to agents/MCP", f)
		}
	}
}