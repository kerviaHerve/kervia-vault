// MCP server tests: spawn the server over in-memory transport and verify
// every tool end-to-end, including auth scoping and template flows.
// SPDX-License-Identifier: AGPL-3.0

package mcp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"golang.org/x/crypto/bcrypt"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

// newMCPSession builds a full server + in-memory connected client.
func newMCPSession(t *testing.T, keyPrefix string) (*mcp.ClientSession, func()) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "mcp.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	adminHash, _ := bcrypt.GenerateFromPassword([]byte("x"), bcrypt.MinCost)
	authSvc := auth.New(st, string(adminHash), 100000)
	enc, _ := crypto.NewEncryptorFromHex(strings.Repeat("ab", 32))

	// seed: vault + agent with write grant
	st.CreateVault("v-1", "test-vault")
	full, prefix, hash, _ := crypto.GenerateAPIKey()
	st.CreateAgent("a-1", "tester", hash, prefix)
	v, _ := st.GetVaultByName("test-vault")
	a, _ := st.ListAgentsByKeyPrefix(prefix)
	if len(a) != 1 {
		t.Fatalf("seed agent: %d", len(a))
	}
	st.AddGrant(a[0].ID, v.ID, true)

	// the API key is exposed to the tools via env (stdio mode)
	t.Setenv("KERVIA_VAULT_API_KEY", full)
	_ = keyPrefix

	srv := Build(Deps{Store: st, Enc: enc, Auth: authSvc})
	ct, stt := mcp.NewInMemoryTransports()
	ss, err := srv.Connect(context.Background(), stt, nil)
	if err != nil {
		t.Fatalf("server connect: %v", err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test-client"}, nil)
	cs, err := client.Connect(context.Background(), ct, nil)
	if err != nil {
		t.Fatalf("client connect: %v", err)
	}
	return cs, func() {
		cs.Close()
		ss.Wait()
		st.Close()
	}
}

type toolError struct{ msg string }

func (e *toolError) Error() string { return e.msg }

func callTool(t *testing.T, cs *mcp.ClientSession, name string, args map[string]any) (string, error) {
	t.Helper()
	if args == nil {
		args = map[string]any{}
	}
	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{
		Name: name, Arguments: args,
	})
	if err != nil {
		return "", err
	}
	if res.IsError {
		// tool-level error: surface as a Go error
		msg := ""
		if len(res.Content) > 0 {
			if tc, ok := res.Content[0].(*mcp.TextContent); ok {
				msg = tc.Text
			}
		}
		return "", &toolError{msg}
	}
	if len(res.Content) == 0 {
		return "", nil
	}
	if tc, ok := res.Content[0].(*mcp.TextContent); ok {
		return tc.Text, nil
	}
	return "", nil
}

func TestMCPFullFlow(t *testing.T) {
	cs, done := newMCPSession(t, "")
	defer done()

	// whoami
	out, err := callTool(t, cs, "whoami", nil)
	if err != nil || !strings.Contains(out, "tester") {
		t.Fatalf("whoami: %v %q", err, out)
	}

	// list_templates
	out, err = callTool(t, cs, "list_templates", nil)
	if err != nil || !strings.Contains(out, "postgres") {
		t.Fatalf("list_templates: %v", err)
	}

	// create templated secret
	out, err = callTool(t, cs, "create_secret", map[string]any{
		"vault": "test-vault", "key": "DB", "template": "postgres",
		"values": map[string]any{
			"host": "db.example.com", "database": "app",
			"username": "u", "password": "p",
		},
	})
	if err != nil {
		t.Fatalf("create_secret: %v", err)
	}
	var created struct{ ID string `json:"id"` }
	_ = json.Unmarshal([]byte(out), &created)
	if created.ID == "" {
		t.Fatalf("create returned no id: %s", out)
	}

	// read it back — structured values
	out, err = callTool(t, cs, "get_secret", map[string]any{"id": created.ID})
	if err != nil || !strings.Contains(out, `"values"`) || !strings.Contains(out, "db.example.com") {
		t.Fatalf("get_secret: %v %s", err, out)
	}

	// list metadata — no values leaked
	out, err = callTool(t, cs, "list_secrets", map[string]any{"vault": "test-vault"})
	if err != nil || strings.Contains(out, `"password":"p"`) {
		t.Fatalf("list leaked values or failed: %v %s", err, out)
	}

	// update
	_, err = callTool(t, cs, "update_secret", map[string]any{"id": created.ID, "value": "v2"})
	if err != nil {
		t.Fatalf("update: %v", err)
	}

	// validation rejection
	_, err = callTool(t, cs, "create_secret", map[string]any{
		"vault": "test-vault", "key": "BAD", "template": "postgres",
		"values": map[string]any{"host": "x"},
	})
	if err == nil || !strings.Contains(err.Error(), "missing required field") {
		t.Fatalf("invalid values accepted: %v", err)
	}

	// forbidden vault
	_, err = callTool(t, cs, "list_secrets", map[string]any{"vault": "other"})
	if err == nil {
		t.Fatal("ungranted vault accessible")
	}
}

func TestMCPBadKeyRejected(t *testing.T) {
	t.Setenv("KERVIA_VAULT_API_KEY", "av_"+strings.Repeat("42", 32))
	dbPath := filepath.Join(t.TempDir(), "mcp2.db")
	st, _ := store.Open(dbPath)
	defer st.Close()
	adminHash, _ := bcrypt.GenerateFromPassword([]byte("x"), bcrypt.MinCost)
	authSvc := auth.New(st, string(adminHash), 100000)
	enc, _ := crypto.NewEncryptorFromHex(strings.Repeat("ab", 32))

	srv := Build(Deps{Store: st, Enc: enc, Auth: authSvc})
	ct, stt := mcp.NewInMemoryTransports()
	ss, _ := srv.Connect(context.Background(), stt, nil)
	client := mcp.NewClient(&mcp.Implementation{Name: "test"}, nil)
	cs, _ := client.Connect(context.Background(), ct, nil)
	defer func() { cs.Close(); ss.Wait() }()

	_, err := callTool(t, cs, "whoami", nil)
	if err == nil {
		t.Fatal("invalid key accepted")
	}
}

func TestMCPCleanEnvFailsClosed(t *testing.T) {
	// no key at all → tools refuse
	t.Setenv("KERVIA_VAULT_API_KEY", "")
	dbPath := filepath.Join(t.TempDir(), "mcp3.db")
	st, _ := store.Open(dbPath)
	defer st.Close()
	adminHash, _ := bcrypt.GenerateFromPassword([]byte("x"), bcrypt.MinCost)
	authSvc := auth.New(st, string(adminHash), 100000)
	enc, _ := crypto.NewEncryptorFromHex(strings.Repeat("ab", 32))

	srv := Build(Deps{Store: st, Enc: enc, Auth: authSvc})
	ct, stt := mcp.NewInMemoryTransports()
	ss, _ := srv.Connect(context.Background(), stt, nil)
	client := mcp.NewClient(&mcp.Implementation{Name: "test"}, nil)
	cs, _ := client.Connect(context.Background(), ct, nil)
	defer func() { cs.Close(); ss.Wait() }()

	_, err := callTool(t, cs, "list_templates", nil)
	if err != nil {
		t.Fatalf("list_templates without key should still work (not secret): %v", err)
	}
	_, err = callTool(t, cs, "whoami", nil)
	if err == nil {
		t.Fatal("whoami without key succeeded — fail-closed violated")
	}
}

// silence the unused os import warning (os is used via t.Setenv)
var _ = os.Getenv