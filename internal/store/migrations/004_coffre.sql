-- Coffre: personal password manager — zero-knowledge storage.
-- The server stores ONLY opaque client-encrypted blobs. It has no key to
-- decrypt them: the coffre key is sealed in the browser by a key derived
-- from the user's master password (PBKDF2/Argon2id, client-side only).
-- No agent API surface exists for these tables (SPEC invariant: agents
-- can never access the coffre).
-- SPDX-License-Identifier: AGPL-3.0

CREATE TABLE IF NOT EXISTS coffre_meta (
    id          INTEGER PRIMARY KEY CHECK (id = 1),  -- single user (v1)
    kdf_algo    TEXT NOT NULL,     -- "pbkdf2" (extensible: argon2id later)
    kdf_params  TEXT NOT NULL,     -- JSON, e.g. {"iterations":600000}
    kdf_salt    BLOB NOT NULL,     -- KDF salt (random, generated client-side)
    wrapped_key BLOB NOT NULL,     -- coffre key sealed by the master key
    verifier    BLOB NOT NULL,     -- constant sealed by the coffre key
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coffre_items (
    id         TEXT PRIMARY KEY,
    blob       BLOB NOT NULL,     -- opaque E2E ciphertext (item JSON)
    version    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT               -- trash (soft delete)
);

CREATE INDEX IF NOT EXISTS idx_coffre_items_deleted ON coffre_items(deleted_at);