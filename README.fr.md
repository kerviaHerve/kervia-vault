<p align="center">
  <img src="docs/logo.png" alt="Kervia-vault" width="420">
</p>

<h3 align="center">Coffre-fort de secrets ultra-rapide pour multi-agents</h3>

<p align="center">
  <b>Un seul binaire Go</b> · API REST + serveur MCP + WebUI embarquée<br>
  Conçu pour <b>Hermes Agent</b>, <b>OpenCode</b> et tout agent IA qui manipule des credentials
</p>

<p align="center">
  <a href="README.md">🇬🇧 English</a> · <b>🇫🇷 Français</b>
</p>

<p align="center">
  <a href="https://github.com/kerviaHerve/kervia-vault/releases"><img src="https://img.shields.io/github/v/release/kerviaHerve/kervia-vault?color=22C55E&label=release" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="license"></a>
  <img src="https://img.shields.io/badge/Go-1.27-00ADD8?logo=go" alt="Go">
  <img src="https://img.shields.io/badge/SQLite-embedded-003B57?logo=sqlite" alt="SQLite">
  <img src="https://img.shields.io/badge/crypto-AES--256--GCM-orange" alt="AES-256-GCM">
</p>

---

- SQLite embarqué (pur Go, sans CGO), AES-256-GCM au repos
- Clés API par agent (Argon2id), grants par vault, versioning immuable, audit append-only
- 51 templates de credentials (OpenAI, PostgreSQL, SMTP, Cloudflare, GitHub…)
- **Auto-mise à jour** depuis la webui — releases vérifiées sha256, données intactes
- Sécurité par conception — AGPL-3.0

## Architecture

Un binaire, un fichier SQLite, trois surfaces — tout ci-dessous tient dans
un seul exécutable statique d'environ 15 Mo :

```
                    ┌─────────────────────────────────────────────┐
                    │              kervia-vault (Go)                 │
                    │                                             │
  agents / IA ────▶ │  /v1/*      API REST    ─┐                  │
  (clé API Bearer)  │  /mcp      serveur MCP  ─┤                  │
                    │             (8 outils)  │                  │
                    │                        ▼                   │
  admin ──────────▶ │  /ui/*  /admin/*  SPA   ─┤   auth           │
  (cookie session)  │             + wizard    │  ┌── Argon2id    │
                    │                        │  │   vérif. clé   │
  releases GitHub ▶ │  auto-maj              │  │   rate limit   │
  (sha256 vérifié)  │  (download→verify→swap)│  └   grants       │
                    │                        ▼        │           │
                    │               ┌──────────────┐ │           │
                    │               │  crypto      │◀┘           │
                    │               │  AES-256-GCM │             │
                    │               │  master key  │             │
                    │               └──────┬───────┘             │
                    │                      ▼                     │
                    │               ┌──────────────┐             │
                    │               │ store (SQLite)│             │
                    │               │ agents, vaults│             │
                    │               │ secrets, audit│             │
                    │               └──────────────┘             │
                    └─────────────────────────────────────────────┘

  /v1/*  clé API agent ───▶ vérif Argon2id ──▶ contrôle grant ──▶ déchiffre
  /admin cookie session ──▶ vérif bcrypt    ──▶ piste d'audit
  données au repos : AES-256-GCM par secret · versions immuables · audit append-only
```

## Installation — une seule commande (Linux, systemd)

> **Plateformes** : Linux (amd64/arm64) est pleinement supporté —
> installeur, service systemd, auto-mise à jour. **macOS en approche** —
> la base de code est 100 % portable (pur Go, sans CGO) et compile pour
> darwin telle quelle ; il manque l'installeur launchd + le service.
> Docker fonctionne sur toutes les plateformes.

```bash
sudo bash install.sh
```

C'est tout. L'installeur :

1. **Demande où binder** — détecte vos adresses, met en avant les VPN
   (NetBird/Tailscale), avertit en rouge avant toute exposition d'IP publique
2. **Télécharge le binaire de la release** GitHub et vérifie son **sha256**
3. Installe un **service systemd durci** (utilisateur dédié,
   `ProtectSystem=strict`, sans root)
4. Ouvre le **wizard de configuration** sur `http://<bind>:8321/ui/` —
   choisissez la langue → acceptez les conditions → définissez le mot de
   passe admin → téléchargez vos codes de récupération → créez votre
   premier agent (sa clé API + un skill prêt à coller pour OpenCode/Hermes)

Mode automatisé, sans prompt :

```bash
KERVIA_VAULT_BIND=10.0.0.5 KERVIA_VAULT_PORT=8321 sudo -E bash install.sh
```

Mises à jour : **Paramètres → Version → Mettre à jour** dans la webui.
Le service télécharge la nouvelle release, la vérifie, se remplace et
redémarre — vos vaults et secrets ne sont jamais touchés.

## Installation — alternative Docker

```bash
# générer la master key
openssl rand -hex 32

# générer le hash du mot de passe admin
docker build -t kervia-vault .
docker run --rm kervia-vault hashpw 'votre-mot-de-passe-admin'

# configurer
cat > .env <<EOF
KERVIA_VAULT_MASTER_KEY=<hex de l'étape 1>
KERVIA_VAULT_ADMIN_HASH=<hash de l'étape 2>
EOF

# lancer
docker compose up -d
# webui : http://localhost:8321/ui/ (login avec le mot de passe admin)
```

## Configuration (variables d'environnement)

| Variable | Requis | Défaut | Description |
|---|---|---|---|
| `KERVIA_VAULT_MASTER_KEY` | ✅ | — | 64 caractères hex (32 octets). Le serveur refuse de démarrer sans. |
| `KERVIA_VAULT_ADMIN_HASH` | ✅ | — | hash bcrypt du mot de passe admin de la webui (`kervia-vault hashpw`). |
| `KERVIA_VAULT_LISTEN` | | `127.0.0.1:8321` | adresse d'écoute. |
| `KERVIA_VAULT_DB` | | `/var/lib/kervia-vault/kervia-vault.db` | chemin SQLite. |
| `KERVIA_VAULT_RATE_PER_MIN` | | `60` | requêtes/minute par clé API. |

## API REST

Auth : `Authorization: Bearer $AG_VAULT_API_KEY` (depuis un fichier 0600 /
variable d'environnement — jamais en ligne) — la clé est scopée aux vaults
accordés.

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/v1/whoami` | identité + vaults accessibles |
| GET | `/v1/vaults` | vaults |
| GET | `/v1/secrets?vault=<nom>` | métadonnées (sans valeurs) |
| GET | `/v1/secrets/{id}` | valeur déchiffrée |
| POST | `/v1/secrets` | création — `{vault,key,value}` ou `{vault,key,template,values}` |
| PATCH | `/v1/secrets/{id}` | mise à jour (nouvelle version) |
| DELETE | `/v1/secrets/{id}` | suppression |
| GET | `/v1/templates` | tous les templates de credentials |
| GET | `/v1/templates/{key}` | un template |

Admin (`/admin/*`, cookie session via `POST /admin/login`) : agents
(création → clé affichée une seule fois), vaults, grants, secrets,
versions, audit.

## MCP (validé E2E — stdio + HTTP)

Deux transports, la même clé scopée par agent :

**stdio (OpenCode) :**
```bash
opencode mcp add kervia-vault --global \
  --env KERVIA_VAULT_API_KEY=av_... \
  --env KERVIA_VAULT_MASTER_KEY=<64 hex> \
  --env KERVIA_VAULT_ADMIN_HASH=<bcrypt> \
  --env KERVIA_VAULT_DB=/opt/kervia-vault/data/kervia-vault.db \
  -- /opt/kervia-vault/bin/kervia-vault --mcp-stdio
```

**HTTP (Hermes — toute machine qui atteint le serveur, sans binaire) :**
```yaml
mcp_servers:
  kervia-vault:
    url: https://your-kerviavault.example.com/mcp   # ← l'URL de votre instance
    headers:
      Authorization: "Bearer ${AG_VAULT_API_KEY}"   # interpolation — jamais la clé brute dans un fichier
```

Outils : `list_vaults` · `list_secrets` · `get_secret` · `create_secret` ·
`update_secret` · `delete_secret` · `list_templates` · `whoami`.

Scoping appliqué par outil (défense en profondeur) : grants revérifiés à
chaque opération ; créations templated validées ; lectures templated
renvoient des objets `values` structurés. Skill pour agents :
`docs/skills/kervia-vault/`. Kit de distribution : `kerviavault-agent-kit.zip`
(binaire + skill + guide).

## Modèle de sécurité

| Menace | Contre-mesure |
|---|---|
| Vol de clé | clés CSPRNG 256 bits, Argon2id (m=64 Mo) stockées hachées, vérification en temps constant, révocation |
| Falsification | tags AES-256-GCM, versioning immuable |
| Initié/écoute | audit append-only, secrets jamais dans les listes/logs, valeurs révélées uniquement sur action explicite |
| Force brute | rate limiting par clé, échecs de login audités |
| Élévation | grants revérifiés dans chaque handler (défense en profondeur), refus par défaut |

Modèle de menace : pas d'E2E côté client (confiance self-hosted), TLS
terminé par le reverse proxy, le chiffrement au repos protège contre
l'exfiltration du fichier DB.

## Développement

```bash
go test -race ./...
gosec ./...
govulncheck ./...
```

Structure : `cmd/kervia-vault` · `internal/{crypto,store,auth,api,mcp,templates,web,model,config}` ·
`migrations` · `web` (embarquée).

## Licence

AGPL-3.0-or-later — voir [LICENSE](LICENSE) (texte intégral).

Copyright (C) 2026 kervia

Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le
modifier selon les termes de la GNU Affero General Public License publiée
par la Free Software Foundation, version 3 de la Licence, ou (à votre
discrétion) toute version ultérieure.

Ce programme est distribué dans l'espoir qu'il sera utile, mais SANS
AUCUNE GARANTIE ; sans même la garantie implicite de COMMERCIALISATION
ou D'ADÉQUATION À UN BESOIN PARTICULIER. Voir la GNU Affero General
Public License pour plus de détails.

Binaires : la source correspondante est ce dépôt (le tag que vous avez
téléchargé). Build : `cd web-app && npm ci && npx vite build` puis
`go build ./cmd/kervia-vault` — les mêmes commandes que la CI.