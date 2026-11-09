-- 008 : note chiffrée par secret (v1.9.3).
-- Une note libre attachée à chaque secret (contexte, rotation, contact…),
-- éditable par les agents (API/MCP) et la webui. AES-256-GCM comme la
-- valeur : le serveur ne stocke QUE (nonce, ciphertext) — jamais la note
-- en clair, jamais dans les logs. NON versionnée (l'historique reste
-- celui de la valeur) ; JAMAIS dévoilée par les liens de partage
-- (une consultation = la valeur seule).
ALTER TABLE secrets ADD COLUMN note_nonce BLOB;
ALTER TABLE secrets ADD COLUMN note_ct BLOB;
