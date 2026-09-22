# Changelog

## v1.0.6 (2026-09-22)

- **SECURITY: the generated skill never contains the API key anymore.**
  The wizard's SKILL.md used to embed the live key in 9 places (YAML,
  stdio, curl, OpenCode CLI+jsonc, Hermes prompt). A key inside a stored/
  logged/shared file is a burned key. Now:
  - the skill documents the connection (URLs, tools, rules) with
    placeholders only (`Bearer ${MCP_AG_VAULT_API_KEY}` interpolation);
  - install is out-of-band: the agent asks the user for the key via the
    client's masked prompt (`hermes mcp add`), or a user-owned 0600 file;
  - the key lives only in the one-time displayed screen + the .txt file
    (with chmod 600 instructions), and the client's own store.
- Generated skill + wizard hint + key file: bilingual FR/EN.
- README/docs skill: interpolation-only examples (no `Bearer av_...`).

## v1.0.5 (2026-09-22)

- README: technical ASCII architecture diagram + release badge.
- Repo description/version kept in sync.

## v1.0.4 (2026-09-22)

- **Update check cache: 6h → 5min** — a freshly published release is
  visible in the webui within minutes instead of hours.

## v1.0.3 (2026-09-22)

- **Auto-reload after self-update** — the settings page polls the
  service and reloads automatically when the new binary is up; the
  "restarting…" screen never stays stuck anymore.

## v1.0.2 (2026-09-22)

- WebUI sidebar footer: clickable AGPL-3.0-or-later license link.

## v1.0.1 (2026-09-22)

- **Setup wizard (first boot)**: language → terms of use → admin
  password → recovery codes → first agent (API key + ready-to-paste
  skill with the instance's real URLs, OpenCode/Hermes install commands).
- **Self-update from the webui**: version badge in the sidebar, one
  click downloads the sha256-verified release, sanity-checks the binary
  and swaps it — data untouched. Docker installs get a clear message
  (read-only filesystem).
- **Installer (install.sh)**: VPN-aware address picker (NetBird/
  Tailscale), red warning + confirmation on public IPs, automated mode
  via `KERVIA_VAULT_BIND`/`KERVIA_VAULT_PORT`, sha256-verified download,
  hardened systemd service (dedicated user, ProtectSystem=strict,
  Restart=always).
- AGPL-3.0 distribution compliance: full license text, module path
  `github.com/kerviaHerve/kervia-vault` (`go install` works).

### Fixed

- Setup takeover window on upgrades: an instance with a real admin
  password is never re-opened in wizard mode (Reconcile at boot).
- Cookie `Secure` is transport-aware — HTTP wizard works on LAN/VPN.
- Login screen rendered again after logout (users were stuck).
- Empty instances: JSON lists are `[]` not `null` (no SPA crash).
- CSP allows embedded woff2 fonts.
- install.sh works over `curl | bash` and actually matches CGNAT/VPN
  ranges.

## v1.0.0 (2026-09-21)

Initial public release.

- One Go binary: REST API + MCP server (stdio + streamable HTTP) +
  embedded WebUI (React SPA).
- SQLite embedded, AES-256-GCM per secret, Argon2id API keys,
  per-vault grants, immutable versioning, append-only audit.
- 51 credential templates.
- CI (test -race, lint, gosec, govulncheck, shellcheck) + release
  workflow (amd64 + arm64 + checksums).

---

AGPL-3.0-or-later — see [LICENSE](LICENSE).