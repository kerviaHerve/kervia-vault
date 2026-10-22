-- 006 : token d'extension navigateur (v1.8.0).
-- Un seul token (ligne id=1) : l'accès de l'extension Firefox au coffre.
-- Le serveur ne stocke que le HASH (Argon2id, même schéma que les clés
-- agents) ; le token en clair n'est montré qu'une fois à la création.
-- Ce token ne donne accès QU'aux blobs chiffrés du coffre (GET /ext/
-- coffre) — aucune surface admin, aucune surface agent (/v1, MCP).
CREATE TABLE IF NOT EXISTS extension_token (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    token_hash   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    last_used_at TEXT NOT NULL DEFAULT ''
);