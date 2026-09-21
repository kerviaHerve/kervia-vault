// API integration tests: full HTTP round trips against a temp database.
// These verify the security invariants end-to-end:
//   - an agent cannot read a vault it has no grant on
//   - an agent cannot write without can_write
//   - revoked keys are rejected
//   - secret values never appear in list responses
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"bytes"
	"encoding/json"
	"fmt"
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

type testEnv struct {
	t       *testing.T
	srv     *httptest.Server
	store   *store.Store
	adminKey string // session cookie value
}

func newTestEnv(t *testing.T) (*testEnv, string, string) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "api.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	enc, _ := crypto.NewEncryptorFromHex(strings.Repeat("ab", 32))

	adminHash, _ := bcrypt.GenerateFromPassword([]byte("admin-pw"), bcrypt.MinCost)
	authSvc := auth.New(st, string(adminHash), 100000)
	apiSrv := New(st, enc)
	adminSrv := NewAdmin(st, enc, authSvc)
	ts := httptest.NewServer(apiSrv.Router(authSvc, adminSrv))
	t.Cleanup(ts.Close)

	// create two vaults and two agents through the admin API
	env := &testEnv{t: t, srv: ts, store: st}
	env.adminLogin()

	env.postJSON("/admin/vaults", map[string]string{"name": "rita-vault"})
	env.postJSON("/admin/vaults", map[string]string{"name": "other-vault"})

	ritaKey := env.createAgent("rita")
	roKey := env.createAgent("ro-agent")

	// rita: read+write on rita-vault; ro-agent: read only
	env.setGrant(ritaAgentID, ritaVaultID(st), true)
	env.setGrant(roAgentID, ritaVaultID(st), false)

	return env, ritaKey, roKey
}

// fixed agent/vault ids resolved by name after creation
var (
	ritaAgentID = ""
	roAgentID   = ""
)

func ritaVaultID(st *store.Store) string { return vaultID(st, "rita-vault") }
func otherVaultID(st *store.Store) string { return vaultID(st, "other-vault") }

func vaultID(st *store.Store, name string) string {
	v, err := st.GetVaultByName(name)
	if err != nil {
		return ""
	}
	return v.ID
}

func agentID(st *store.Store, name string) string {
	agents, _ := st.ListAgents()
	for _, a := range agents {
		if a.Name == name {
			return a.ID
		}
	}
	return ""
}

func (e *testEnv) adminLogin() {
	body, _ := json.Marshal(map[string]string{"password": "admin-pw"})
	req, _ := http.NewRequest("POST", e.srv.URL+"/admin/login", bytes.NewReader(body))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatalf("login: %v", err)
	}
	defer res.Body.Close()
	for _, c := range res.Cookies() {
		if c.Name == "av_session" {
			e.adminKey = c.Value
		}
	}
}

func (e *testEnv) do(method, path string, body any, apiKey string) *http.Response {
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	if e.adminKey != "" && strings.HasPrefix(path, "/admin") && apiKey == "" {
		req.AddCookie(&http.Cookie{Name: "av_session", Value: e.adminKey})
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatalf("%s %s: %v", method, path, err)
	}
	return res
}

func (e *testEnv) postJSON(path string, body any) *http.Response { return e.do("POST", path, body, "") }

func (e *testEnv) createAgent(name string) string {
	res := e.postJSON("/admin/agents", map[string]string{"name": name})
	if res.StatusCode != 201 {
		e.t.Fatalf("createAgent %s: %d", name, res.StatusCode)
	}
	var out struct{ APIKey string `json:"api_key"` }
	_ = json.NewDecoder(res.Body).Decode(&out)
	res.Body.Close()
	// resolve the id
	agents, _ := e.store.ListAgents()
	for _, a := range agents {
		if a.Name == name {
			if name == "rita" {
				ritaAgentID = a.ID
			} else {
				roAgentID = a.ID
			}
		}
	}
	return out.APIKey
}

func (e *testEnv) setGrant(agentID, vaultID string, write bool) {
	res := e.postJSON("/admin/grants", map[string]any{"agent_id": agentID, "vault_id": vaultID, "can_write": write})
	res.Body.Close()
}

func TestFullAgentLifecycle(t *testing.T) {
	env, ritaKey, roKey := newTestEnv(t)

	// create a secret as rita (write grant)
	res := env.do("POST", "/v1/secrets",
		map[string]string{"vault": "rita-vault", "key": "API_TOKEN", "value": "tok-123"}, ritaKey)
	if res.StatusCode != 201 {
		var e map[string]any
		_ = json.NewDecoder(res.Body).Decode(&e)
		res.Body.Close()
		t.Fatalf("create secret: %d %v", res.StatusCode, e)
	}
	var created struct{ ID string `json:"id"` }
	_ = json.NewDecoder(res.Body).Decode(&created)
	res.Body.Close()

	// read it back
	res = env.do("GET", "/v1/secrets/"+created.ID, nil, ritaKey)
	if res.StatusCode != 200 {
		t.Fatalf("get secret: %d", res.StatusCode)
	}
	var got map[string]any
	_ = json.NewDecoder(res.Body).Decode(&got)
	res.Body.Close()
	if got["value"] != "tok-123" {
		t.Fatalf("value = %v", got["value"])
	}

	// list must NOT contain values
	res = env.do("GET", "/v1/secrets?vault=rita-vault", nil, ritaKey)
	var list []map[string]any
	_ = json.NewDecoder(res.Body).Decode(&list)
	res.Body.Close()
	if len(list) == 0 || list[0]["value"] != nil {
		t.Fatalf("list leaked values or empty: %v", list)
	}

	// ro-agent can read but NOT write
	res = env.do("GET", "/v1/secrets/"+created.ID, nil, roKey)
	if res.StatusCode != 200 {
		t.Fatalf("ro read: %d", res.StatusCode)
	}
	res.Body.Close()
	res = env.do("POST", "/v1/secrets",
		map[string]string{"vault": "rita-vault", "key": "X", "value": "y"}, roKey)
	if res.StatusCode != 403 {
		t.Fatalf("ro write accepted: %d", res.StatusCode)
	}
	res.Body.Close()

	// no grant on other-vault at all
	res = env.do("GET", "/v1/secrets?vault=other-vault", nil, ritaKey)
	if res.StatusCode != 403 {
		t.Fatalf("access to ungranted vault: %d", res.StatusCode)
	}
	res.Body.Close()
}

func TestRevokedKeyRejected(t *testing.T) {
	env, ritaKey, _ := newTestEnv(t)
	// revoke via admin
	res := env.do("POST", "/admin/agents/"+ritaAgentID+"/revoke", nil, "")
	res.Body.Close()
	// the agent is now rejected
	res = env.do("GET", "/v1/vaults", nil, ritaKey)
	if res.StatusCode != 401 {
		t.Fatalf("revoked accepted: %d", res.StatusCode)
	}
	res.Body.Close()
}

func TestUnknownKeyRejected(t *testing.T) {
	env, _, _ := newTestEnv(t)
	fake := "av_" + strings.Repeat("42", 32)
	res := env.do("GET", "/v1/vaults", nil, fake)
	if res.StatusCode != 401 {
		t.Fatalf("unknown key: %d", res.StatusCode)
	}
	res.Body.Close()
}

func TestUpdateAndVersions(t *testing.T) {
	env, ritaKey, _ := newTestEnv(t)
	res := env.do("POST", "/v1/secrets",
		map[string]string{"vault": "rita-vault", "key": "DB", "value": "v1"}, ritaKey)
	var created struct{ ID string `json:"id"` }
	_ = json.NewDecoder(res.Body).Decode(&created)
	res.Body.Close()

	res = env.do("PATCH", "/v1/secrets/"+created.ID, map[string]string{"value": "v2"}, ritaKey)
	res.Body.Close()
	res = env.do("GET", "/v1/secrets/"+created.ID, nil, ritaKey)
	var got map[string]any
	_ = json.NewDecoder(res.Body).Decode(&got)
	res.Body.Close()
	if got["value"] != "v2" || got["version"] != float64(2) {
		t.Fatalf("update failed: %v", got)
	}
	// versions visible via admin
	res = env.do("GET", "/admin/versions/"+created.ID, nil, "")
	var versions []map[string]any
	_ = json.NewDecoder(res.Body).Decode(&versions)
	res.Body.Close()
	if len(versions) != 2 {
		t.Fatalf("versions = %d", len(versions))
	}
}

func TestAuditTrail(t *testing.T) {
	env, ritaKey, _ := newTestEnv(t)
	env.do("GET", "/v1/vaults", nil, ritaKey).Body.Close()
	res := env.do("GET", "/admin/audit?limit=50", nil, "")
	var entries []map[string]any
	_ = json.NewDecoder(res.Body).Decode(&entries)
	res.Body.Close()
	if len(entries) == 0 {
		t.Fatal("empty audit trail")
	}
	// no audit entry may carry a secret value
	for _, e := range entries {
		if s := fmt.Sprint(e); strings.Contains(s, "tok-123") {
			t.Fatal("secret value found in audit — leak")
		}
	}
}

type testing2 = testing.T
func TestTemplateSecretCreation(t *testing.T) {
	env, ritaKey, _ := newTestEnv(t)

	// templated creation — postgres
	res := env.do("POST", "/v1/secrets", map[string]any{
		"vault": "rita-vault", "key": "PROD_DB", "template": "postgres",
		"values": map[string]any{
			"host": "db.kervia.ch", "port": 5432, "database": "app",
			"username": "app", "password": "s3cr3t", "sslmode": "require",
		},
	}, ritaKey)
	if res.StatusCode != 201 {
		var e map[string]any
		_ = json.NewDecoder(res.Body).Decode(&e)
		res.Body.Close()
		t.Fatalf("templated create: %d %v", res.StatusCode, e)
	}
	var created struct{ ID string `json:"id"` }
	_ = json.NewDecoder(res.Body).Decode(&created)
	res.Body.Close()

	// read back: value is the JSON object, template field set
	res = env.do("GET", "/v1/secrets/"+created.ID, nil, ritaKey)
	var got struct {
		Template string         `json:"template"`
		Values   map[string]any `json:"values"`
	}
	_ = json.NewDecoder(res.Body).Decode(&got)
	res.Body.Close()
	if got.Template != "postgres" {
		t.Fatalf("template = %q", got.Template)
	}
	if got.Values["host"] != "db.kervia.ch" || got.Values["password"] != "s3cr3t" {
		t.Fatalf("values = %v", got.Values)
	}

	// invalid: missing required field
	res = env.do("POST", "/v1/secrets", map[string]any{
		"vault": "rita-vault", "key": "BAD", "template": "postgres",
		"values": map[string]any{"host": "x"},
	}, ritaKey)
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatalf("invalid values accepted: %d", res.StatusCode)
	}

	// unknown template
	res = env.do("POST", "/v1/secrets", map[string]any{
		"vault": "rita-vault", "key": "BAD2", "template": "nope",
		"values": map[string]any{"a": "b"},
	}, ritaKey)
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatalf("unknown template accepted: %d", res.StatusCode)
	}

	// templates endpoints
	res = env.do("GET", "/v1/templates", nil, ritaKey)
	var tpls []map[string]any
	_ = json.NewDecoder(res.Body).Decode(&tpls)
	res.Body.Close()
	if len(tpls) < 40 {
		t.Fatalf("templates = %d", len(tpls))
	}
	res = env.do("GET", "/v1/templates/postgres", nil, ritaKey)
	var tpl map[string]any
	_ = json.NewDecoder(res.Body).Decode(&tpl)
	res.Body.Close()
	if tpl["key"] != "postgres" {
		t.Fatal("template detail broken")
	}
}
