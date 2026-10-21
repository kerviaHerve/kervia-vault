-- Ephemeral one-time share links (v1.5).
--
-- SPDX-License-Identifier: AGPL-3.0
--
-- The token itself is NEVER stored — only its SHA-256. A share is consumed
-- exactly once (consumed_at set under a WHERE consumed_at IS NULL guard, the
-- rowcount decides); expired or consumed links answer identically (no
-- enumeration). Rows are swept lazily on each creation.

CREATE TABLE IF NOT EXISTS shares (
    id          TEXT PRIMARY KEY,
    token_hash  TEXT NOT NULL UNIQUE,
    secret_id   TEXT NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
    created_by  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    consumed_at TEXT,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token_hash);