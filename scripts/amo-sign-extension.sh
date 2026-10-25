#!/bin/bash
# Kervia-vault — signature AMO (unlisted) de l'extension Firefox.
#
# Signe extension-firefox/ via l'API addons.mozilla.org (web-ext sign,
# canal unlisted), puis dépose l'XPI SIGNÉ dans le data dir du serveur :
# la webui le sert en priorité sur l'embarqué non signé (override
# internal/web — dataDir). Résultat : installation PERMANENTE dans
# Firefox (fini about:debugging) + mises à jour automatiques
# (update_url → /ui/extension-updates.json, généré par la release).
#
# Les identifiants AMO (JWT issuer + secret) sont lus dans kervia-vault
# via l'API agent REST et passés à web-ext par VARIABLES D'ENVIRONNEMENT
# (WEB_EXT_API_KEY / WEB_EXT_API_SECRET) — jamais affichés, jamais en
# argv, jamais écrits sur disque.
#
# Usage :
#   scripts/amo-sign-extension.sh [chemin-sortie-xpi]
#     AG_VAULT_URL      défaut http://100.100.108.242:8321
#     AG_VAULT_KEY_FILE défaut /ag (clé av_ de l'agent)
#     AMO_EXT_ID        défaut coffre@kervia-vault
#
# Prérequis : node ≥ 18 (npx), jq, curl, unzip. La première soumission
# de l'extension doit avoir été faite à la main sur addons.mozilla.org
# (Developer Hub) pour que l'id AMO existe — les versions suivantes
# passent par ce script.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-/var/lib/kervia-vault/extension-firefox.xpi}"
AG_VAULT_URL="${AG_VAULT_URL:-http://100.100.108.242:8321}"
AG_VAULT_KEY_FILE="${AG_VAULT_KEY_FILE:-/ag}"
AMO_EXT_ID="${AMO_EXT_ID:-coffre@kervia-vault}"

command -v node >/dev/null 2>&1 || { echo "ERREUR : node requis (npx web-ext)"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "ERREUR : jq requis"; exit 1; }
[ -r "$AG_VAULT_KEY_FILE" ] || { echo "ERREUR : clé agent illisible : $AG_VAULT_KEY_FILE"; exit 1; }
[ -f "$REPO_ROOT/extension-firefox/manifest.json" ] || { echo "ERREUR : extension-firefox/ introuvable (repo : $REPO_ROOT)"; exit 1; }

VAULT_KEY="$(cat "$AG_VAULT_KEY_FILE")"
AUTH="Authorization: Bearer $VAULT_KEY"

# ---- 1. identifiants AMO depuis le vault (entrée clé « user:…:… ») ----
LIST="$(curl -sf --max-time 15 -H "$AUTH" "$AG_VAULT_URL/v1/secrets")"
SEC_ID="$(printf '%s' "$LIST" | jq -r '[.[] | select(.key | test("^user:[0-9]+:[0-9]+$"))][0].id // empty')"
if [ -z "$SEC_ID" ]; then
  echo "ERREUR : aucune entrée « user:<id>:<client> » (JWT AMO) dans le vault"
  exit 1
fi
DETAIL="$(curl -sf --max-time 15 -H "$AUTH" "$AG_VAULT_URL/v1/secrets/$SEC_ID")"
AMO_KEY="$(printf '%s' "$DETAIL" | jq -r '.key')"
AMO_SECRET="$(printf '%s' "$DETAIL" | jq -r '.value')"
if [ -z "$AMO_SECRET" ] || [ "$AMO_SECRET" = "null" ]; then
  echo "ERREUR : la valeur de l'entrée AMO est vide"
  exit 1
fi
echo "vault : identifiants AMO trouvés (issuer « $AMO_KEY ») ✓"

# ---- 2. signature via l'API AMO (canal unlisted, id fixe) ----
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "signature AMO en cours (unlisted, id $AMO_EXT_ID)…"
WEB_EXT_API_KEY="$AMO_KEY" WEB_EXT_API_SECRET="$AMO_SECRET" \
  npx --yes web-ext@8 sign \
  --source-dir "$REPO_ROOT/extension-firefox" \
  --artifacts-dir "$TMP" \
  --channel unlisted \
  --id "$AMO_EXT_ID" \
  --timeout-wait 900

# ---- 3. dépôt de l'XPI signé (servi par la webui, priorité embarqué) ----
XPI="$(find "$TMP" -name '*.xpi' -type f | head -n 1)"
[ -n "$XPI" ] || { echo "ERREUR : aucun XPI signé produit"; exit 1; }
mkdir -p "$(dirname "$OUT")"
install -m 0644 "$XPI" "$OUT"

SIGNED_VERSION="$(unzip -p "$OUT" manifest.json | jq -r '.version')"
SIGNED_ID="$(unzip -p "$OUT" manifest.json | jq -r '.["browser_specific_settings"].gecko.id')"
echo "✓ XPI signé installé : $OUT"
echo "  version : $SIGNED_VERSION — id : $SIGNED_ID"
echo "  servi par la webui : /ui/extension-firefox.xpi (override, sans redémarrage)"