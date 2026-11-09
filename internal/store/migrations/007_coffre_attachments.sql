-- 007 : pièces jointes chiffrées du coffre (v1.9.0).
-- Zero-knowledge, comme tout le coffre : le serveur ne stocke QUE des blobs
-- opaques scellés côté navigateur par la coffreKey (AES-256-GCM). DEUX blobs
-- distincts : `meta` (petit — {filename, mime, size} scellés, se déchiffre
-- seul pour l'affichage) et `data` (contenu binaire scellé). Le serveur ne
-- connaît ni le nom, ni le type, ni le contenu d'aucune pièce jointe.
-- Quotas appliqués dans l'API (pas ici) : 2 Mo/file, 5/item.
CREATE TABLE IF NOT EXISTS coffre_attachments (
    id         TEXT PRIMARY KEY,
    item_id    TEXT NOT NULL,
    meta       BLOB NOT NULL,
    data       BLOB NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coffre_attachments_item ON coffre_attachments(item_id);
