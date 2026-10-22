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
	Template  string    `json:"template,omitempty"` // template key (null = free-form)
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
	ID        int64     `json:"id"`
	TS        time.Time `json:"ts"`
	AgentID   string    `json:"agent_id"` // "admin" for webui actions
	Action    string    `json:"action"`
	Resource  string    `json:"resource"`
	Detail    string    `json:"detail,omitempty"`
	Source    string    `json:"source,omitempty"`     // agent | webui | mcp
	IP        string    `json:"ip,omitempty"`
	UserAgent string    `json:"user_agent,omitempty"`
	Method    string    `json:"method,omitempty"`
	Status    int       `json:"status,omitempty"`
	Path      string    `json:"path,omitempty"`
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

// Share-link audit actions — the ephemeral one-time links. The audit NEVER
// carries the token (only the secret id); the share page logs the viewer IP.
const (
	AuditShareCreate = "share_create" // admin minted a one-time link (ttl in the detail)
	AuditShareView   = "share_view"   // link consumed — value disclosed once
)

// AuditExport — the DR bundle export action (passphrase-sealed, all vaults).
// The detail carries the filename only, never content.
const AuditExport = "export"

// Restore audit actions — webui restore of missing vaults from a bundle.
// Counts and vault names only — values never reach the audit.
const (
	AuditRestoreVerify = "restore_verify" // dry-run: bundle opened, inventory reported
	AuditRestoreImport = "restore_import" // missing vaults created, values re-sealed
)

// 2FA (TOTP) audit actions — the admin second factor lifecycle.
const (
	Audit2FAEnroll  = "2fa_enroll"   // pending seed generated (not yet active)
	Audit2FAEnable  = "2fa_enabled"  // enrollment confirmed, login now requires a code
	Audit2FADisable = "2fa_disabled" // both factors provided, factor removed
	Audit2FAReset   = "2fa_reset"    // recovery-driven reset (code consumed, TOTP wiped)
)

// Coffre audit actions. The coffre is the personal password manager:
// audit entries carry ONLY actions and opaque item IDs — never item
// names or content (those are end-to-end encrypted, the server cannot
// know them).
const (
	AuditCoffreCreate     = "coffre_create"     // coffre initialised (first unlock setup)
	AuditCoffreRekey      = "coffre_rekey"      // master password rewrap (new KDF params)
	AuditCoffreDestroy    = "coffre_destroy"    // coffre + all items wiped
	AuditCoffreItemCreate = "coffre_item_create"
	AuditCoffreItemUpdate = "coffre_item_update"
	AuditCoffreItemDelete = "coffre_item_delete"  // moved to trash
	AuditCoffreItemRestore = "coffre_item_restore"
	AuditCoffreItemPurge  = "coffre_item_purge"    // hard delete of one item
	AuditCoffreTrashPurge = "coffre_trash_purge"   // hard delete of all trash
	AuditCoffreImport    = "coffre_import"        // batch create (import)
)

// CoffreMeta is the zero-knowledge header of the coffre. Every field is
// opaque to the server: kdf_algo/kdf_params/kdf_salt let the browser
// re-derive the master key from the master password; wrapped_key is the
// coffre key sealed by that master key; verifier is a known constant
// sealed by the coffre key so the client can detect a wrong password.
// The server can NEVER decrypt coffre items.
type CoffreMeta struct {
	ID         int       `json:"-"`
	KDFAlgo    string    `json:"kdf_algo"`
	KDFParams  string    `json:"kdf_params"`
	KDFSalt    []byte    `json:"kdf_salt_b64"`
	WrappedKey []byte    `json:"wrapped_key_b64"`
	Verifier   []byte    `json:"verifier_b64"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// CoffreItem is one end-to-end encrypted item of the coffre. Blob is
// ciphertext produced in the browser (WebCrypto AES-256-GCM); the
// server never sees names, URLs, usernames or passwords — all are
// inside the encrypted blob.
type CoffreItem struct {
	ID        string     `json:"id"`
	Blob      []byte     `json:"blob_b64"`
	Version   int        `json:"version"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
}
