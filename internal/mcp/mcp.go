// Package mcp implements the MCP server of Kervia-vault.
// It exposes the vault to AI agents as typed tools, with MCP annotations
// (readOnly/destructive hints) so clients can make informed decisions.
//
// One server, two transports:
//   - stdio (subprocess mode: opencode/hermes spawn the binary)
//   - streamable HTTP at /mcp (remote mode, behind the same auth as the REST API)
//
// Authentication: the agent's API key is taken from the MCP context
// (stdio: the KERVIA_VAULT_API_KEY env var of the subprocess; HTTP: the
// Authorization header, verified by the shared auth middleware).
//
// SPDX-License-Identifier: AGPL-3.0
package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/model"
	"github.com/kerviaHerve/kervia-vault/internal/store"
	"github.com/kerviaHerve/kervia-vault/internal/templates"
)

// Deps carries what tools need.
type Deps struct {
	Store *store.Store
	Enc   *crypto.Encryptor
	Auth  *auth.Service
}

// Build assembles the full MCP server with every tool.
func Build(deps Deps) *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{
		Name:    "kervia-vault",
		Version: "1.0.0",
		Title:   "Kervia-vault",
	}, &mcp.ServerOptions{
		Instructions: instructions,
	})

	ro := &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: boolPtr(false)}
	destructive := &mcp.ToolAnnotations{
		ReadOnlyHint:     false,
		DestructiveHint:  boolPtr(true),
		OpenWorldHint:    boolPtr(false),
	}
	nonDestructive := &mcp.ToolAnnotations{
		ReadOnlyHint:     false,
		DestructiveHint:  boolPtr(false),
		IdempotentHint:   false,
		OpenWorldHint:    boolPtr(false),
	}
	idempotent := &mcp.ToolAnnotations{
		ReadOnlyHint:     false,
		DestructiveHint:  boolPtr(false),
		IdempotentHint:   true,
		OpenWorldHint:    boolPtr(false),
	}

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_vaults",
		Description: "List the vaults available to you.",
		Annotations: ro,
	}, deps.toolListVaults)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_secrets",
		Description: "List secret metadata (id, key, template, version — never values) in a vault.",
		Annotations: ro,
	}, deps.toolListSecrets)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "get_secret",
		Description: "Read a secret's decrypted value. Templated secrets return a structured object.",
		Annotations: ro,
	}, deps.toolGetSecret)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_templates",
		Description: "List credential templates (openai, postgres, smtp, cloudflare…) with their fields. Use a template's 'values' fields when creating a templated secret.",
		Annotations: ro,
	}, deps.toolListTemplates)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "create_secret",
		Description: "Create a secret in a vault you can write. Either free-form ({vault,key,value}) or templated ({vault,key,template,values}).",
		Annotations: nonDestructive,
	}, deps.toolCreateSecret)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "update_secret",
		Description: "Update a secret's value (creates a new version; history is kept).",
		Annotations: idempotent,
	}, deps.toolUpdateSecret)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "delete_secret",
		Description: "Delete a secret. Destructive: the value is removed (audit keeps the trace).",
		Annotations: destructive,
	}, deps.toolDeleteSecret)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "whoami",
		Description: "Your agent identity and accessible vaults.",
		Annotations: ro,
	}, deps.toolWhoami)

	return srv
}

const instructions = `Kervia-vault holds credentials for AI agents.
Start with list_vaults / list_secrets to discover what you can access.
Secrets may be free-form (value: string) or templated (values: object
matching a template — see list_templates). When creating credentials for
known services (openai, postgres, smtp, cloudflare, github...), ALWAYS
prefer the template form: fields are validated and well-named.
Never log or echo secret values beyond what the task strictly requires.`

// ---- agent resolution ----

// agentFor resolves the calling agent from the tool context.
//
// HTTP transport: the auth middleware has ALREADY authenticated the Bearer
// key and stored the agent in the context — we read that (no re-verification,
// no env). The middleware guarantees: valid key, non-revoked, rate-limited.
//
// stdio transport (subprocess): no HTTP middleware exists, so the key comes
// from the KERVIA_VAULT_API_KEY environment variable of the spawned process.
func (d *Deps) agentFor(ctx context.Context) (*model.Agent, error) {
	if a, ok := auth.AgentFrom(ctx); ok {
		return a, nil
	}
	// stdio mode: key from the process environment
	key := strings.TrimSpace(getEnv("KERVIA_VAULT_API_KEY"))
	if key == "" || !crypto.ValidateAPIKeyFormat(key) {
		return nil, fmt.Errorf("no valid API key (set KERVIA_VAULT_API_KEY)")
	}
	a, err := d.Auth.VerifyKey(key)
	if err != nil {
		return nil, fmt.Errorf("unauthorized")
	}
	return a, nil
}

// ---- tools ----

func (d *Deps) toolListVaults(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
	agent, err := d.agentFor(ctx)
	if err != nil {
		return nil, nil, err
	}
	vaults, err := d.Store.ListVaultsForAgent(agent.ID)
	if err != nil {
		return nil, nil, fmt.Errorf("internal")
	}
	out, _ := json.Marshal(vaults)
	return textResult(string(out)), nil, nil
}

type listSecretsArgs struct {
	Vault string `json:"vault"`
}

func (d *Deps) toolListSecrets(ctx context.Context, _ *mcp.CallToolRequest, args listSecretsArgs) (*mcp.CallToolResult, any, error) {
	agent, err := d.agentFor(ctx)
	if err != nil {
		return nil, nil, err
	}
	vault, err := d.Store.GetVaultByName(args.Vault)
	if err != nil {
		return nil, nil, fmt.Errorf("vault not found")
	}
	ok, err := d.Store.HasGrant(agent.ID, vault.ID, false)
	if err != nil || !ok {
		return nil, nil, fmt.Errorf("forbidden")
	}
	secrets, err := d.Store.ListSecretsByVault(vault.ID)
	if err != nil {
		return nil, nil, fmt.Errorf("internal")
	}
	out, _ := json.Marshal(secrets)
	return textResult(string(out)), nil, nil
}

type getSecretArgs struct {
	ID string `json:"id"`
}

func (d *Deps) toolGetSecret(ctx context.Context, _ *mcp.CallToolRequest, args getSecretArgs) (*mcp.CallToolResult, any, error) {
	agent, err := d.agentFor(ctx)
	if err != nil {
		return nil, nil, err
	}
	sec, nonce, ct, err := d.Store.GetSecretByID(args.ID)
	if err != nil {
		return nil, nil, fmt.Errorf("secret not found")
	}
	ok, err := d.Store.HasGrant(agent.ID, sec.VaultID, false)
	if err != nil || !ok {
		_ = d.Store.AppendAudit(agent.ID, model.AuditRead, "secret/"+args.ID, "denied:no_grant")
		return nil, nil, fmt.Errorf("forbidden")
	}
	value, err := d.Enc.Decrypt(nonce, ct)
	if err != nil {
		return nil, nil, fmt.Errorf("internal")
	}
	_ = d.Store.AppendAudit(agent.ID, model.AuditRead, "secret/"+args.ID, "")
	// structured output for templated secrets
	if sec.Template != "" {
		var obj map[string]any
		if json.Unmarshal(value, &obj) == nil {
			return textResult(mustJSON(map[string]any{
				"id": sec.ID, "key": sec.Key, "template": sec.Template,
				"version": sec.Version, "values": obj,
			})), nil, nil
		}
	}
	return textResult(mustJSON(map[string]any{
		"id": sec.ID, "key": sec.Key, "version": sec.Version, "value": string(value),
	})), nil, nil
}

func (d *Deps) toolListTemplates(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
	return textResult(mustJSON(templates.All())), nil, nil
}

type createSecretArgs struct {
	Vault    string         `json:"vault"`
	Key      string         `json:"key"`
	Value    string         `json:"value,omitempty"`
	Template string         `json:"template,omitempty"`
	Values   map[string]any `json:"values,omitempty"`
}

func (d *Deps) toolCreateSecret(ctx context.Context, _ *mcp.CallToolRequest, args createSecretArgs) (*mcp.CallToolResult, any, error) {
	agent, err := d.agentFor(ctx)
	if err != nil {
		return nil, nil, err
	}
	vault, err := d.Store.GetVaultByName(args.Vault)
	if err != nil {
		return nil, nil, fmt.Errorf("vault not found")
	}
	ok, err := d.Store.HasGrant(agent.ID, vault.ID, true)
	if err != nil || !ok {
		_ = d.Store.AppendAudit(agent.ID, model.AuditCreate, "vault/"+args.Vault+"/secret/"+args.Key, "denied:no_grant")
		return nil, nil, fmt.Errorf("forbidden: no write access to this vault")
	}
	var payload []byte
	var templateKey string
	if args.Template != "" {
		tpl, found := templates.Get(args.Template)
		if !found {
			return nil, nil, fmt.Errorf("unknown template %q (use list_templates)", args.Template)
		}
		if args.Values == nil {
			return nil, nil, fmt.Errorf("templated secrets require 'values'")
		}
		if errs := tpl.Validate(args.Values); len(errs) > 0 {
			return nil, nil, fmt.Errorf("validation: %s", strings.Join(errs, "; "))
		}
		payload, _ = json.Marshal(args.Values)
		templateKey = args.Template
	} else {
		if args.Value == "" {
			return nil, nil, fmt.Errorf("provide 'value' or 'template'+'values'")
		}
		payload = []byte(args.Value)
	}
	nonce, ct, err := d.Enc.Encrypt(payload)
	if err != nil {
		return nil, nil, fmt.Errorf("internal")
	}
	sec, err := d.Store.CreateSecret(newID(), vault.ID, args.Key, templateKey, nonce, ct, newID(), agent.ID)
	if err != nil {
		return nil, nil, fmt.Errorf("create failed (already exists?)")
	}
	_ = d.Store.AppendAudit(agent.ID, model.AuditCreate, "vault/"+args.Vault+"/secret/"+args.Key, "")
	return textResult(mustJSON(map[string]any{"id": sec.ID, "key": sec.Key, "template": templateKey, "version": 1})), nil, nil
}

type updateSecretArgs struct {
	ID    string `json:"id"`
	Value string `json:"value"`
}

func (d *Deps) toolUpdateSecret(ctx context.Context, _ *mcp.CallToolRequest, args updateSecretArgs) (*mcp.CallToolResult, any, error) {
	agent, err := d.agentFor(ctx)
	if err != nil {
		return nil, nil, err
	}
	sec, _, _, err := d.Store.GetSecretByID(args.ID)
	if err != nil {
		return nil, nil, fmt.Errorf("secret not found")
	}
	ok, err := d.Store.HasGrant(agent.ID, sec.VaultID, true)
	if err != nil || !ok {
		_ = d.Store.AppendAudit(agent.ID, model.AuditUpdate, "secret/"+args.ID, "denied:no_grant")
		return nil, nil, fmt.Errorf("forbidden")
	}
	nonce, ct, err := d.Enc.Encrypt([]byte(args.Value))
	if err != nil {
		return nil, nil, fmt.Errorf("internal")
	}
	if err := d.Store.UpdateSecretValue(args.ID, nonce, ct, agent.ID, newID()); err != nil {
		return nil, nil, fmt.Errorf("update failed")
	}
	_ = d.Store.AppendAudit(agent.ID, model.AuditUpdate, "secret/"+args.ID, "")
	return textResult(mustJSON(map[string]any{"status": "updated", "id": args.ID})), nil, nil
}

type deleteSecretArgs struct {
	ID string `json:"id"`
}

func (d *Deps) toolDeleteSecret(ctx context.Context, _ *mcp.CallToolRequest, args deleteSecretArgs) (*mcp.CallToolResult, any, error) {
	agent, err := d.agentFor(ctx)
	if err != nil {
		return nil, nil, err
	}
	sec, _, _, err := d.Store.GetSecretByID(args.ID)
	if err != nil {
		return nil, nil, fmt.Errorf("secret not found")
	}
	ok, err := d.Store.HasGrant(agent.ID, sec.VaultID, true)
	if err != nil || !ok {
		return nil, nil, fmt.Errorf("forbidden")
	}
	if err := d.Store.DeleteSecret(args.ID); err != nil {
		return nil, nil, fmt.Errorf("delete failed")
	}
	_ = d.Store.AppendAudit(agent.ID, model.AuditDelete, "secret/"+args.ID, "")
	return textResult(mustJSON(map[string]any{"status": "deleted", "id": args.ID})), nil, nil
}

func (d *Deps) toolWhoami(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
	agent, err := d.agentFor(ctx)
	if err != nil {
		return nil, nil, err
	}
	vaults, _ := d.Store.ListVaultsForAgent(agent.ID)
	return textResult(mustJSON(map[string]any{
		"id": agent.ID, "name": agent.Name, "vaults": vaults,
	})), nil, nil
}