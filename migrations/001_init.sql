-- Kervia-vault initial schema
-- SPDX-License-Identifier: AGPL-3.0

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    key_hash   TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    last_used  TEXT
);

CREATE TABLE IF NOT EXISTS vaults (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grants (
    agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    vault_id   TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    can_write  INTEGER NOT NULL DEFAULT 0,
    granted_at TEXT NOT NULL,
    PRIMARY KEY (agent_id, vault_id)
);

CREATE TABLE IF NOT EXISTS secrets (
    id         TEXT PRIMARY KEY,
    vault_id   TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    nonce      BLOB NOT NULL,
    ciphertext BLOB NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (vault_id, key)
);

CREATE TABLE IF NOT EXISTS secret_versions (
    id         TEXT PRIMARY KEY,
    secret_id  TEXT NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
    version    INTEGER NOT NULL,
    nonce      BLOB NOT NULL,
    ciphertext BLOB NOT NULL,
    written_by TEXT NOT NULL,
    written_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    action   TEXT NOT NULL,
    resource TEXT NOT NULL,
    detail   TEXT
);

CREATE INDEX IF NOT EXISTS idx_secrets_vault ON secrets(vault_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id, ts);
CREATE INDEX IF NOT EXISTS idx_versions_secret ON secret_versions(secret_id);
