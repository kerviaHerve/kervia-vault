# Changelog

## v1.3.0 (2026-10-21)

- **Support macOS — Apple Silicon & Intel.** Kervia-vault tourne nativement
  sur Mac avec le même modèle de sécurité que sur Linux :
  - **Binaires darwin** (arm64 + amd64) publiés dans chaque release GitHub,
    vérifiés sha256 comme les autres plateformes. L'auto-mise à jour de la
    webui détecte l'OS et télécharge `kervia-vault-darwin-*.tar.gz`.
  - **Installeur macOS** : `curl … | sudo bash` détecte macOS et installe le
    même parcours que Linux — binaire sha256-vérifié, compte de service
    dédié `_kerviavault` (dscl, sans shell, masqué de l'écran de login),
    LaunchDaemon `ch.kervia.vault` avec `KeepAlive` (l'équivalent exact de
    `Restart=always` : la self-update quitte proprement, launchd relance
    le nouveau binaire).
  - **Mêmes propriétés de sécurité** : le daemon ne tourne pas en root,
    la master key ne vit que dans le plist `600` root:wheel, le binaire
    réside dans le data dir (`/usr/local/var/kervia-vault/bin`) pour que la
    self-update puisse écrire SON propre binaire — symlink root-owned dans
    `/usr/local/bin`.
  - **Updater cross-OS** : résolution du binaire réel sur darwin via
    `os.Executable` + `EvalSymlinks` (`/proc/self/exe` n'existe pas sur
    macOS) ; le mode `launchd` est reporté à la webui à la place de
    `systemd`.
  - **install.sh compatible bash 3.2** (macOS stock) — `mapfile` retiré ;
    réseau via `ifconfig`, checksums via `shasum`, port via `lsof`.
    La source des releases est overridable (`KERVIA_VAULT_RELEASES_URL`)
    pour les tests et les miroirs privés, en miroir de
    `KERVIA_VAULT_UPDATE_URL` côté binaire.
  - La config par défaut de la DB devient OS-aware (`/usr/local/var` sur
    macOS) — l'installeur la fixe explicitement, le défaut ne sert qu'aux
    lancements manuels.

## v1.2.0 (2026-10-15)

- **Coffre personnel : un vrai gestionnaire de mots de passe, invisible des agents.**
  Un coffre pour vos identifiants personnels, chiffré **de bout en bout dans le
  navigateur** (zero-knowledge, comme Bitwarden) — les agents n'y ont
  **jamais** accès, même en théorie :
  - **Chiffrement client** : mot de passe maître → PBKDF2-SHA256 600k
    (WebCrypto natif, pas de WASM, CSP stricte inchangée) → masterKey qui
    scelle la coffreKey (32 B aléatoire). Le serveur ne stocke **que des
    blobs opaques** : une compromission totale du serveur ne révèle rien,
    et aucun mot de passe maître ne transite jamais.
  - **Triple isolation agents** : routes uniquement dans l'API admin
    (session), zéro surface `/v1`/MCP (testée en intégration + tripwire
    source), audit actions + IDs opaques uniquement.
  - Fonctionnalités : logins + notes sécurisées, dossiers, favoris,
    recherche locale, TOTP 2FA générés dans la webui (seed chiffré),
    générateur (caractères / passphrase) + indicateur de force, historique
    des mots de passe, corbeille (restauration + purge), import/export JSON
    Bitwarden/Vaultwarden, concurrence optimiste par version, copie
    presse-papier avec effacement auto (30 s).
  - **Verrouillage** : auto-lock paramétrable (1/5/15/60 min, défaut 5),
    la clé ne vit qu'en mémoire JS — un rechargement de page reverrouille.
  - **Aucune récupération possible** (zero-knowledge) : mot de passe maître
    perdu = coffre perdu — c'est la contrepartie de la garantie
    d'inaccessibilité. Warning explicite à la création.

## v1.1.0 (2026-10-14)

- **Rebranding complet vers Kervia-vault** (kit KERVIA-BRANDING-APPS-v01) :
  - Palette Kervia officielle (charbon #171B19, citron #B8E263, menthe #7FD4B8) —
    les valeurs hexadécimales locales sont remplacées par des rôles de tokens.
  - **Thème clair ajouté** : bascule sombre/clair (persistée, `data-theme` sur
    `<html>`, boot sans flash via `theme-boot.js` servi en externe — CSP stricte
    inchangée), logo Kervia officiel swapé par thème.
  - Typographie : Space Grotesk locale (OFL, embarquée — aucun chargement
    externe) ; JetBrains Mono conservé pour les valeurs de secrets.
  - Logo Kervia intact + nom produit séparé dans la sidebar, le login et le
    wizard (règle du kit) ; favicons/manifest/android-chrome remplacés.
  - Fixes de service embarqué : les fichiers racine de la WebUI (favicon,
    manifest, theme-boot.js) sont maintenant servis avec leur vrai type MIME
    (ils étaient avalés par le fallback SPA en `text/html`).
  - Focus clavier : anneau 2 px menthe, espacement 3 px, respecté par les
    transitions existantes.
  - Identité technique : module `github.com/kerviaHerve/kervia-vault`, binaire
    `kervia-vault`, variables `KERVIA_VAULT_*`. Le préfixe des clés API `av_`
    et le cookie `av_session` sont inchangés (compatibilité des agents
    existants).

## v1.0.12 (2026-09-22)

- **[strix vuln-0001, CWE-200, CVSS 5.3] `/setup/info` recon hardening**:
  once setup is done, the public endpoint returns only `{"setup_done":true}` —
  the internal listen address and exact version are no longer disclosed
  unauthenticated (they were only ever needed by the first-boot wizard).
  Verified by a first autonomous pentest (Strix + DeepSeek V4 Pro) against
  the production instance; 18 attack surfaces covered, 1 finding, fixed.

## v1.0.11 (2026-09-22)

- **Security audit (full code Sentinel pass).** All surfaces reviewed —
  auth chains, per-secret grant re-verification, crypto, webui, MCP,
  installer, CI, dependencies (govulncheck/npm: clean).
- **Fix [audit trail]**: the webui secret reveal now leaves a `read`
  trace in the append-only audit (SPEC: repudiation — every decrypted
  read is an action; agents were audited, the admin reveal wasn't).
- **Fix [memory hygiene]**: expired admin sessions are swept every hour
  — the in-memory session map grew forever before (one leaked entry
  per login on a long-lived process).

## v1.0.10 (2026-09-22)

- **Quick copy from the list.** A copy button next to the eye on every
  secret row (and in search results): copies the main credential
  (token/password/key field for templated secrets, the value for
  free-form) straight to the clipboard with a toast — no dialog needed.

## v1.0.9 (2026-09-22)

- **Eye toggle in edit fields.** Editing a sensitive field (API token,
  password, secret…) now shows a small eye in the input to reveal the
  value while editing — both in the secret dialog and the create form.

## v1.0.8 (2026-09-22)

- **No JSON anywhere in the UI.** Secret reveal and edit moved to a
  proper dialog: labeled field cards (masked sensitive values, per-field
  copy) and one input PER template field for editing — the client sends
  `{values: {field: value}}`, the server validates against the template
  and stores the new version. Free-form secrets edit in a plain textarea.

## v1.0.7 (2026-09-22)

- **WebUI: elegant secret reveal.** Templated secrets now show a labeled
  field card (the template's human labels — "API token", not "api_token"),
  sensitive fields masked until clicked, per-field copy on hover, and a
  discreet "copy raw JSON" for machine use. Free-form secrets unchanged.

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