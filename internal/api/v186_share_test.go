// v1.8.6 — share revocation: a live link can be killed before its TTL.
// Invariants under test:
//   - list: the admin sees active links of a secret, NEVER the token/hash
//   - revoke: a revoked link is dead for viewers (same gone page as consumed)
//   - revoke is idempotent (second call succeeds, stays dead)
//   - audit: share_revoke is recorded
//
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestShareRevokeBeforeExpiry(t *testing.T) {
	env, _, _ := newTestEnv(t)
	env.postJSON("/admin/vaults", map[string]string{"name": "rev-vault"})
	env.postJSON("/admin/secrets", map[string]any{"vault": "rev-vault", "key": "K", "value": "precious"})

	list := listSecrets(t, env, "rev-vault")
	if len(list) != 1 {
		t.Fatalf("want 1 secret, got %d", len(list))
	}

	// mint two links on the same secret
	var minted []string
	for i := 0; i < 2; i++ {
		res := env.postJSON("/admin/secrets/"+list[0].ID+"/share", map[string]any{"ttl_minutes": 60})
		if res.StatusCode != 200 {
			t.Fatalf("share %d: status %d", i, res.StatusCode)
		}
		var s struct {
			URL string `json:"url"`
		}
		_ = json.NewDecoder(res.Body).Decode(&s)
		res.Body.Close()
		minted = append(minted, s.URL)
	}

	// list: 2 liens vivants, aucun token ne sort
	res := eDo(env, "GET", "/admin/shares?secret_id="+list[0].ID, nil)
	var shares []map[string]any
	_ = json.NewDecoder(res.Body).Decode(&shares)
	res.Body.Close()
	if res.StatusCode != 200 || len(shares) != 2 {
		t.Fatalf("list shares: status %d, %d rows (want 2)", res.StatusCode, len(shares))
	}
	raw, _ := json.Marshal(shares)
	if strings.Contains(string(raw), "token") || strings.Contains(string(raw), strings.TrimPrefix(minted[0], "/share/")) {
		t.Fatal("the share list must NEVER leak the token or its hash")
	}

	// revoke the first minted link (list is created_at DESC → oldest = last row)
	id, _ := shares[len(shares)-1]["id"].(string)
	if id == "" {
		t.Fatal("share id missing")
	}
	if res := eDo(env, "DELETE", "/admin/shares/"+id, nil); res.StatusCode != 200 {
		t.Fatalf("revoke: status %d", res.StatusCode)
	}

	// the revoked link is DEAD for the viewer — same gone page as a consumed link
	r, _ := http.Get(env.srv.URL + minted[0])
	b, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if strings.Contains(string(b), "precious") || !strings.Contains(string(b), "Link expired") {
		t.Fatal("a revoked link must be dead (gone page, never the value)")
	}

	// the OTHER link is still alive
	r2, _ := http.Get(env.srv.URL + minted[1])
	b2, _ := io.ReadAll(r2.Body)
	r2.Body.Close()
	if r2.StatusCode != 200 || !strings.Contains(string(b2), "precious") {
		t.Fatal("revoking one link must NOT kill its sibling")
	}

	// idempotent: revoke again → 200, still dead
	if res := eDo(env, "DELETE", "/admin/shares/"+id, nil); res.StatusCode != 200 {
		t.Fatalf("re-revoke must be idempotent, got %d", res.StatusCode)
	}

	// list: plus AUCUN lien vivant — le premier est révoqué, le second a été
	// consommé par la vérification "still alive" ci-dessus (la consultation
	// EST la consommation : one-time par construction).
	res = eDo(env, "GET", "/admin/shares?secret_id="+list[0].ID, nil)
	_ = json.NewDecoder(res.Body).Decode(&shares)
	res.Body.Close()
	if len(shares) != 0 {
		t.Fatalf("want 0 active share after revoke+consume, got %d", len(shares))
	}

	// audit trail
	res = eDo(env, "GET", "/admin/audit?limit=50", nil)
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), "share_revoke") {
		t.Fatal("share_revoke must be audited")
	}
}

// eDo : wrapper local — le testEnv expose do(method, path, body, apiKey).
func eDo(env *testEnv, method, path string, body any) *http.Response {
	return env.do(method, path, body, "")
}
