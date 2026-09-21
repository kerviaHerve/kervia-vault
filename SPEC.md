# Kervia-vault — Spécification v1.0 (security by design)

> Single Go binary. SQLite embedded. AES-256-GCM at rest. REST + MCP + WebUI.
> License AGPL-3.0. Pas un MVP : perfection dès la première ligne.

## 1. Modèle de menace (STRIDE, condensé)

| Menace | Contre-mesure (dans le design, pas en patch) |
|---|---|
| **S**poofing (agent usurpé) | Clés API 32 bytes aléatoires (CSPRNG), stockées **hashées** (Argon2id), jamais loguées, préfixe visible `av_` + hash |
| **T**ampering (secret modifié) | Versioning immuable : chaque écriture = nouvelle version, audit signé, chiffrement authentifié (GCM tag) |
| **R**epudiation (déni) | Audit log append-only : chaque read/write/create/revoke authentifié par clé API → agent id |
| **I**nformation disclosure | AES-256-GCM par secret, master key via env var (pas en DB), réponses sans valeur pour les agents non autorisés, zero secrets dans les logs (PII-safe logging) |
| **D**enial of service | Rate limiting par clé (token bucket), limites de payload, SQLite WAL + timeouts contexte |
| **E**levation of privilege | Scoping strict par clé : l'agent N'agit QUE sur ses vaults grantés, deny implicite, tests d'intrusion automatisés |

Hypothèses acceptées (documentées) : pas d'E2E (modèle trust-server, comme OpenBao/Infisical self-hosted) ; le transport est protégé par TLS (NPM wildcard) + mesh NetBird ; le serveur voit les secrets en clair en mémoire.

## 2. Schéma SQLite (WAL, migrations versionnées)

```sql
-- migrations: table schema_migrations(version INTEGER PRIMARY KEY, applied_at)
CREATE TABLE agents (
    id          TEXT PRIMARY KEY,          -- UUIDv7
    name        TEXT NOT NULL UNIQUE,
    key_hash    TEXT NOT NULL,             -- Argon2id(api_key) — la clé claire n'est JAMAIS stockée
    key_prefix  TEXT NOT NULL,             -- 8 premiers chars, pour l'affichage webui "av_ab12…"
    created_at  TEXT NOT NULL,             -- RFC3339 UTC
    revoked_at  TEXT,                      -- NULL = actif
    last_used   TEXT
);
CREATE TABLE vaults (
    id          TEXT PRIMARY KEY,          -- UUIDv7
    name        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
);
CREATE TABLE grants (                      -- agent ↔ vault, N:N
    agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    can_write   INTEGER NOT NULL DEFAULT 0,-- 0=read, 1=read+write
    granted_at  TEXT NOT NULL,
    PRIMARY KEY (agent_id, vault_id)
);
CREATE TABLE secrets (
    id          TEXT PRIMARY KEY,          -- UUIDv7
    vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,             -- ex: CRAWL4AI_TOKEN
    nonce       BLOB NOT NULL,             -- 12 bytes GCM
    ciphertext  BLOB NOT NULL,             -- AES-256-GCM(value), tag inclus
    version     INTEGER NOT NULL DEFAULT 1,
    created_by  TEXT NOT NULL,            -- agent id ou "admin"
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (vault_id, key)
);
CREATE TABLE secret_versions (             -- historique immuable
    id          TEXT PRIMARY KEY,          -- UUIDv7
    secret_id   TEXT NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    nonce       BLOB NOT NULL,
    ciphertext  BLOB NOT NULL,
    written_by  TEXT NOT NULL,
    written_at  TEXT NOT NULL
);
CREATE TABLE audit_log (                   -- append-only
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL,
    agent_id    TEXT NOT NULL,             -- "admin" pour le webui
    action      TEXT NOT NULL,             -- read|create|update|delete|revoke_agent|grant|login_fail|...
    resource    TEXT NOT NULL,             -- "vault/<id>/secret/<key>"
    detail      TEXT                      -- JSON optionnel (jamais de valeur de secret)
);
-- index obligatoires
CREATE INDEX idx_secrets_vault ON secrets(vault_id);
CREATE INDEX idx_audit_ts ON audit_log(ts);
CREATE INDEX idx_audit_agent ON audit_log(agent_id, ts);
```

## 3. Endpoints REST

### Auth
- Header : `Authorization: Bearer av_<64 hex>`. Middleware : hash Argon2id → lookup par key_prefix → verify → agent actif + grants chargés en contexte. Constant-time compare.
- Failures : 401 + audit `login_fail` (rate limited).

### API agents (scopée par grants)
| Méthode | Chemin | Description |
|---|---|---|
| GET | `/v1/vaults` | vaults accessibles à l'agent |
| GET | `/v1/secrets?vault=<name>` | liste (id, key, version, updated_at — SANS valeurs) |
| GET | `/v1/secrets/<id>` | secret déchiffré `{key, value, version}` |
| POST | `/v1/secrets` | créer `{vault, key, value}` (si can_write) |
| PATCH | `/v1/secrets/<id>` | update valeur (si can_write) — crée version |
| DELETE | `/v1/secrets/<id>` | soft delete + audit (si can_write) |
| GET | `/v1/whoami` | identité agent + scopes (debug agents) |

### API admin (auth séparée : session webui, pas une clé d'agent)
| Méthode | Chemin | Description |
|---|---|---|
| POST | `/admin/agents` | créer agent → **clé affichée UNE fois** |
| POST | `/admin/agents/<id>/revoke` | révoquer |
| GET | `/admin/agents` | liste (avec last_used, prefix) |
| POST | `/admin/vaults` | créer vault |
| POST | `/admin/grants` | `{agent, vault, can_write}` |
| DELETE | `/admin/grants` | retirer |
| GET | `/admin/secrets?vault=` | liste + valeurs déchiffrées (webui) |
| POST | `/admin/secrets` | créer (webui, choix vault) |
| GET | `/admin/audit` | audit paginé + filtres |
| GET | `/admin/versions/<secret_id>` | historique d'un secret |

Conventions : JSON partout, timestamps RFC3339 UTC, IDs UUIDv7, erreurs `{error, message, request_id}`, request_id dans chaque réponse (slog corrélé).

## 4. MCP (intégré, même binaire)

| Tool | Annotations |
|---|---|
| `list_vaults()` | readOnly |
| `list_secrets(vault)` | readOnly — sans valeurs |
| `get_secret(id)` | readOnly — valeur |
| `create_secret(vault, key, value)` | destructiveHint=false, idempotentHint=false |
| `update_secret(id, value)` | idempotentHint=true |
| `delete_secret(id)` | **destructiveHint=true** |
| `whoami()` | readOnly |

Serveur MCP : instructions intégrées (usage + sécurité), auth = même clé API via header/environnement, stdio **et** streamable HTTP (une seule implémentation mcp-go, 2 transports).

## 5. Webui (embed dans le binaire)

- Stack : HTML + HTMX + Tailwind (CDN) — **zéro node_modules**, c'est le point "pas de dispersion"
- Auth admin : mot de passe maître (env var, bcrypt) → session cookie (SameSite=Strict, HttpOnly, Secure)
- Écrans : Dashboard (stats) · Agents (liste/créer → modal avec clé affichée 1×/révoquer) · Vaults · Secrets (table par vault, créer avec dropdown, valeurs masquées + toggle "révéler" via POST admin) · Grants (matrice agent×vault) · Audit (table filtrable)
- Tout en français, minimal, clair.

## 6. Crypto (règles exactes)

- Master key : 32 bytes env `KERVIA_VAULT_MASTER_KEY` (hex 64). Absente → le serveur refuse de démarrer (fail-closed).
- Chiffrement : AES-256-GCM par secret, nonce aléatoire 12 bytes unique, nonce stocké avec le ciphertext.
- Rotation master key : endpoint admin `POST /admin/rotate-key` → re-chiffre tout (transaction).
- Clés API : 32 bytes CSPRNG, format `av_<hex64>` ; stockage Argon2id(m=64MB, t=3, p=2) ; vérification par prefix-lookup puis constant-time.
- Mots de passe webui : bcrypt cost 12.

## 7. Non-fonctionnel

- **Perf cible** : read p99 < 5 ms, write p99 < 15 ms (SQLite WAL, prepared statements, zero alloc dans le hot path si possible).
- **Logging** : slog JSON, request_id, **jamais** de valeurs de secrets (règle testée par fuzz).
- **Rate limit** : 60 req/min/clé par défaut (config), token bucket en mémoire.
- **Config** : env vars + flag `--config` (yaml), valeurs : listen addr, db path, master key, admin password hash, rate limits.
- **Tests** : table-driven, coverage cible ≥ 80% sur le core (crypto, auth, scoping), fuzz sur le parsing, integration sur l'API avec SQLite tmp.
- **CI (dans le repo)** : golangci-lint + gosec + govulncheck + `go test -race` + build.

## 8. Structure du repo (golang-project-layout)

```
kervia-vault/
├── cmd/kervia-vault/main.go        — flags, config load, wiring
├── internal/
│   ├── crypto/                   — AES-GCM, Argon2id, keygen (aucun log de secret)
│   ├── store/                    — SQLite, migrations embed, requêtes
│   ├── model/                    — types Agent/Vault/Grant/Secret
│   ├── auth/                     — middleware clé API + sessions webui + rate limit
│   ├── api/                      — handlers REST (agents + admin)
│   ├── mcp/                      — serveur MCP (tools, annotations, instructions)
│   ├── audit/                    — append-only, nettoyage optionnel (rétention)
│   └── config/                   — load/validate (fail-closed)
├── web/                          — HTML/HTMX/Tailwind → go:embed
├── migrations/                   — .sql versionnées → go:embed
├── .golangci.yml                 — gosec ON, errcheck ON, strict
├── Dockerfile                    — distroless/static, multi-stage
└── go.mod                        — deps minimales : mcp-go, go/modernc.org/sqlite, golang.org/x/crypto
```

Dépendances MAX (5) : `modelcontextprotocol/go-sdk` (MCP officiel), `modernc.org/sqlite` (pur Go, pas CGO), `golang.org/x/crypto` (argon2, bcrypt), `google/uuid` (v7). RIEN d'autre — chi/router stdlib `net/http` suffit (Go 1.22+ patterns).

## 9. Ce qu'on ne fait PAS (scope discipline)

- Pas d'E2E, pas de clients mobiles, pas de partage agent↔agent, pas de dynamic secrets, pas de PKI.
- Pas de postgres/redis/serveur externe.
- Pas de multi-tenant humain (1 admin).
- Un seul binaire + un fichier SQLite = tout.

## 10. Définition of Done

1. `go test -race ./...` vert, coverage core ≥ 80%
2. `gosec` + `golangci-lint` zéro finding bloquant
3. Benchmark : read p99 < 5 ms, write p99 < 15 ms (benchstat dans le repo)
4. Audit de chaque action vérifié par test
5. Scan fuzz sur 30 s sans crash
6. RITA lit/crée via MCP < 10 ms mesurés
7. Webui complet : agent → clé 1×, secret → vault au choix, matrice grants, audit
8. Dockerfile distroless + compose + doc install