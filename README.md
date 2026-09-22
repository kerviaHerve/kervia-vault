# Kervia-vault

Ultra-fast multi-agent secrets vault. **One Go binary**: REST API + MCP server + embedded WebUI.

- SQLite embedded (pure Go, no CGO), AES-256-GCM at rest
- Per-agent API keys (Argon2id), per-vault grants, immutable versioning, append-only audit
- 51 credential templates (OpenAI, PostgreSQL, SMTP, Cloudflare, GitHub…)
- Security by design — AGPL-3.0

## Quick start — installer (systemd, recommended)

```bash
sudo bash install.sh
```

Interactive installer: picks the bind address (NetBird/Tailscale VPN
detected, public IPs warned), downloads the verified release binary
(sha256), installs a hardened systemd service and opens the setup
wizard at `http://<bind>/ui/` — language → terms → admin password →
recovery codes → first agent (API key + ready-to-paste skill).

Automated (no prompts): `KERVIA_VAULT_BIND=10.0.0.5 KERVIA_VAULT_PORT=8321 sudo -E bash install.sh`

Updates: from the webui (Settings → Version → *Update now*) —
self-update with sha256-verified releases, data untouched.

## Quick start — Docker

```bash
# generate the master key
openssl rand -hex 32

# generate the admin password hash
docker build -t kervia-vault .
docker run --rm kervia-vault hashpw 'your-admin-password'

# configure
cat > .env <<EOF
KERVIA_VAULT_MASTER_KEY=<hex from step 1>
KERVIA_VAULT_ADMIN_HASH=<hash from step 2>
EOF

# run
docker compose up -d
# webui: http://localhost:8321/ui/ (login with the admin password)
```

## Configuration (environment)

| Variable | Required | Default | Description |
|---|---|---|---|
| `KERVIA_VAULT_MASTER_KEY` | ✅ | — | 64 hex chars (32 bytes). Server refuses to boot without it. |
| `KERVIA_VAULT_ADMIN_HASH` | ✅ | — | bcrypt hash of the webui admin password (`kervia-vault hashpw`). |
| `KERVIA_VAULT_LISTEN` | | `127.0.0.1:8321` | listen address. |
| `KERVIA_VAULT_DB` | | `/var/lib/kervia-vault/kervia-vault.db` | SQLite path. |
| `KERVIA_VAULT_RATE_PER_MIN` | | `60` | requests/minute per API key. |

## REST API

Auth: `Authorization: Bearer av_<key>` — key is scoped to the granted vaults.

| Method | Path | Description |
|---|---|---|
| GET | `/v1/whoami` | identity + accessible vaults |
| GET | `/v1/vaults` | vaults |
| GET | `/v1/secrets?vault=<name>` | metadata (no values) |
| GET | `/v1/secrets/{id}` | decrypted value |
| POST | `/v1/secrets` | create — `{vault,key,value}` or `{vault,key,template,values}` |
| PATCH | `/v1/secrets/{id}` | update (new version) |
| DELETE | `/v1/secrets/{id}` | delete |
| GET | `/v1/templates` | all credential templates |
| GET | `/v1/templates/{key}` | one template |

Admin (`/admin/*`, session cookie from `POST /admin/login`): agents (create →
key shown once), vaults, grants, secrets, versions, audit.

## MCP (validated E2E — stdio + HTTP)

Two transports, the same agent-scoped key:

**stdio (OpenCode):**
```bash
opencode mcp add kervia-vault --global \
  --env KERVIA_VAULT_API_KEY=av_... \
  --env KERVIA_VAULT_MASTER_KEY=<64 hex> \
  --env KERVIA_VAULT_ADMIN_HASH=<bcrypt> \
  --env KERVIA_VAULT_DB=/opt/kervia-vault/data/kervia-vault.db \
  -- /opt/kervia-vault/bin/kervia-vault --mcp-stdio
```

**HTTP (Hermes — any machine that can reach the server, no binary needed):**
```yaml
mcp_servers:
  kervia-vault:
    url: https://your-kerviavault.example.com/mcp   # ← your instance's URL
    headers:
      Authorization: "Bearer av_..."
```

Tools: `list_vaults` · `list_secrets` · `get_secret` · `create_secret` ·
`update_secret` · `delete_secret` · `list_templates` · `whoami`.

Scoping enforced per tool (defense in depth): grants re-verified on
every operation; templated creates validated; templated reads return
structured `values` objects. Skill for agents: `docs/skills/kervia-vault/`.
Agent distribution kit: `kerviavault-agent-kit.zip` (binary + skill + guide).

## Security model

| Threat | Mitigation |
|---|---|
| Key theft | 256-bit CSPRNG keys, Argon2id (m=64MB) stored hashed, constant-time verify, revocation |
| Tampering | AES-256-GCM tags, immutable versioning |
| Insider/eavesdropping | append-only audit log, secrets never in lists/logs, values revealed only on explicit action |
| Brute force | per-key rate limiting, failed logins audited |
| Escalation | grants re-verified in every handler (defense in depth), deny by default |

Threat model: no client-side E2E (self-hosted trust), TLS terminated by the
reverse proxy, encryption at rest protects DB file exfiltration.

## Development

```bash
go test -race ./...
gosec ./...
govulncheck ./...
```

Layout: `cmd/kervia-vault` · `internal/{crypto,store,auth,api,mcp,templates,web,model,config}` ·
`migrations` · `web` (embedded).

## License

AGPL-3.0-or-later — see [LICENSE](LICENSE) (full text).

Copyright (C) 2026 kervia

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Affero General Public License for more details.

Binary releases: the corresponding source is this repository (the tag
you downloaded). Build it with `cd web-app && npm ci && npx vite build`
then `go build ./cmd/kervia-vault` — same commands the CI runs.