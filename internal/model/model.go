// Package model defines the core domain types of Kervia-vault.
// SPDX-License-Identifier: AGPL-3.0

package model

import "time"

// Agent is an API consumer (a machine, an AI agent).
type Agent struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	KeyHash   string     `json:"-"`          // Argon2id hash — never serialized
	KeyPrefix string     `json:"key_prefix"` // 8 first chars, for webui display
	CreatedAt time.Time  `json:"created_at"`
	RevokedAt *time.Time `json:"revoked_at,omitempty"`
	LastUsed  *time.Time `json:"last_used,omitempty"`
}

// Vault is a named collection of secrets.
type Vault struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

// Grant links an agent to a vault with a permission level.
type Grant struct {
	AgentID   string    `json:"agent_id"`
	VaultID   string    `json:"vault_id"`
	CanWrite bool      `json:"can_write"`
	GrantedAt time.Time `json:"granted_at"`
}

// Secret is a stored credential. Value is the decrypted plaintext;
// it never appears in list responses (only in GetSecret).
type Secret struct {
	ID        string    `json:"id"`
	VaultID   string    `json:"vault_id"`
	VaultName string    `json:"vault_name,omitempty"`
	Key       string    `json:"key"`
	Value     string    `json:"value,omitempty"` // omitted in lists
	Version   int       `json:"version"`
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// SecretVersion is an immutable historical entry of a secret.
type SecretVersion struct {
	ID        string    `json:"id"`
	SecretID  string    `json:"secret_id"`
	Version   int       `json:"version"`
	WrittenBy string    `json:"written_by"`
	WrittenAt time.Time `json:"written_at"`
}

// AuditEntry is one line of the append-only audit trail.
type AuditEntry struct {
	ID      int64     `json:"id"`
	TS      time.Time `json:"ts"`
	AgentID string    `json:"agent_id"` // "admin" for webui actions
	Action  string    `json:"action"`
	Resource string   `json:"resource"`
	Detail  string    `json:"detail,omitempty"`
}

// Audit actions (constants — no free-form strings from callers).
const (
	AuditRead          = "read"
	AuditCreate       = "create"
	AuditUpdate       = "update"
	AuditDelete       = "delete"
	AuditLoginFail    = "login_fail"
	AuditAgentCreate  = "agent_create"
	AuditAgentRevoke  = "agent_revoke"
	AuditVaultCreate  = "vault_create"
	AuditGrant        = "grant"
	AuditGrantRevoke  = "grant_revoke"
	AuditKeyRotate    = "key_rotate"
	AuditRateLimited  = "rate_limited"
)
