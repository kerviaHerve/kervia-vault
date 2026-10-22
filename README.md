<p align="center">
  <img src="docs/logo.png" alt="Kervia-vault" width="420">
</p>

<h3 align="center">Ultra-fast multi-agent secrets vault</h3>

<p align="center">
  <b>One Go binary</b> · REST API + MCP server + embedded WebUI<br>
  Built for <b>Hermes Agent</b>, <b>OpenCode</b> and any AI agent that needs credentials
</p>

<p align="center">
  <b>🇬🇧 English</b> · <a href="README.fr.md">🇫🇧 Français</a>
</p>

<p align="center">
  <a href="https://github.com/kerviaHerve/kervia-vault/releases"><img src="https://img.shields.io/github/v/release/kerviaHerve/kervia-vault?color=20956B&label=release" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="license"></a>
  <img src="https://img.shields.io/badge/Go-1.27-00ADD8?logo=go" alt="Go">
  <img src="https://img.shields.io/badge/SQLite-embedded-003B57?logo=sqlite" alt="SQLite">
  <img src="https://img.shields.io/badge/crypto-AES--256--GCM-orange" alt="AES-256-GCM">
</p>

---

- SQLite embedded (pure Go, no CGO), AES-256-GCM at rest
- Per-agent API keys (Argon2id), per-vault grants, immutable versioning, append-only audit
- **Admin 2FA (TOTP)** — second factor on the webui login, recovery codes reset it
- **One-time share links** — a secret, one view, then the link is dead
- **Encrypted DR export** — passphrase-sealed bundle of every vault, CLI restore
- 51 credential templates (OpenAI, PostgreSQL, SMTP, Cloudflare, GitHub…)
- **Self-update** from the webui — sha256-verified releases, data untouched
- **Zero-knowledge personal vault** (password manager) in the browser, invisible to agents — 14 templates (cards, identities, SSH…), Bitwarden/1Password/CSV import, multi-TOTP
- Security by design — AGPL-3.0

## Architecture

One binary, one SQLite file, three surfaces — everything below ships in
a single ~15 MB static executable:

```
                    ┌─────────────────────────────────────────────┐
                    │              kervia-vault (Go)                 │
                    │                                             │
  agents / AI ────▶ │  /v1/*      REST API   ─┐                   │
  (API key Bearer)  │  /mcp      MCP server  ─┤                   │
                    │             (8 tools)   │                   │
                    │                        ▼                   │
  admin ──────────▶ │  /ui/*  /admin/*  SPA  ─┤   auth            │
  (session cookie)  │             + wizard   │  ┌── Argon2id     │
                    │                        │  │   key verify   │
  GitHub releases ▶ │  self-update           │  │   rate limit   │
  (sha256-checked)  │  (download→verify→swap)│  └   grants       │
                    │                        ▼        │          │
                    │               ┌──────────────┐ │          │
                    │               │  crypto      │◀┘          │
                    │               │  AES-256-GCM │            │
                    │               │  master key  │            │
                    │               └──────┬───────┘            │
                    │                      ▼                    │
                    │               ┌──────────────┐            │
                    │               │ store (SQLite)│            │
                    │               │ agents, vaults│            │
                    │               │ secrets, audit│            │
                    │               └──────────────┘            │
                    └─────────────────────────────────────────────┘

  /v1/*  agent API key ──▶ Argon2id verify ──▶ grant check ──▶ decrypt
  /admin session cookie ─▶ bcrypt verify    ──▶ audit trail
  data at rest: AES-256-GCM per secret · versions immutable · audit append-only
```

## Install — one command (Linux & macOS)

> **Platforms**: Linux (amd64/arm64) and macOS (Apple Silicon & Intel) are
> fully supported — installer, hardened service (systemd unit / launchd
> daemon), self-update. Docker works on any platform.

```bash
sudo bash install.sh
```

That's it. The installer:

1. **Asks where to bind** — detects your addresses, highlights VPN ones
   (NetBird/Tailscale), warns in red before any public-IP exposure
2. **Downloads the release binary** from GitHub and verifies its **sha256**
3. Installs a **hardened service** — systemd unit on Linux (`ProtectSystem=strict`),
   LaunchDaemon on macOS (`KeepAlive`), both under a dedicated no-shell
   user, master key in a `600` root-only file
4. Opens the **setup wizard** at `http://<bind>:8321/ui/` — pick your
   language → accept the terms → set the admin password → download your
   recovery codes → create your first agent (its API key + a
   ready-to-paste skill for OpenCode/Hermes)

Automated, no prompts:

```bash
KERVIA_VAULT_BIND=10.0.0.5 KERVIA_VAULT_PORT=8321 sudo -E bash install.sh
```

Updates: **Settings → Version → Update now** in the webui. The service
downloads the newer release, verifies it, swaps itself and restarts —
your vaults and secrets are never touched.

## Install — Docker alternative

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

Auth: `Authorization: Bearer $AG_VAULT_API_KEY` (from a 0600 file / env var —
never inline) — key is scoped to the granted vaults.

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
      Authorization: "Bearer ${AG_VAULT_API_KEY}"   # interpolation — never the raw key in a file
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
| Agents reading personal passwords | **the Coffre (personal password manager) is end-to-end encrypted in the browser — the server only stores opaque blobs, and there is NO agent surface for it** (session-guarded routes only, tested) |

Threat model: no client-side E2E for the shared agent vaults (self-hosted
trust), TLS terminated by the reverse proxy, encryption at rest protects
DB file exfiltration. The personal Coffre is the exception: it IS
client-side E2E (zero-knowledge) because it must stay invisible to
agents even in theory — losing the master password means losing the
coffre (no server-side recovery, by design).

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