#!/bin/bash
# Kervia-vault installer — binaire + systemd + wizard web
#
# Usage interactif :  bash install.sh
# Usage automatisé :  KERVIA_VAULT_BIND=100.x.y.z KERVIA_VAULT_PORT=8321 bash install.sh
#   (en mode pipe — curl … | bash — les variables d'env remplacent les prompts ;
#    sans variables, la suggestion intelligente est utilisée)
set -euo pipefail

BIN_NAME="kervia-vault"
INSTALL_DIR="/usr/local/bin"
DATA_DIR="/var/lib/kervia-vault"
SERVICE="kervia-vault"
SERVICE_USER="kervia-vault"
DEFAULT_PORT="8321"
GITHUB_RELEASES="https://github.com/kerviaHerve/kervia-vault/releases/latest"
PLACEHOLDER="setup-placeholder"

bold="\033[1m"; dim="\033[2m"; red="\033[0;31m"; green="\033[0;32m"; orange="\033[0;33m"; reset="\033[0m"

say()  { printf "${bold}▸${reset} %s\n" "$1"; }
warn() { printf "${orange}⚠ %s${reset}\n" "$1"; }
err()  { printf "${red}✗ %s${reset}\n" "$1"; exit 1; }

# ─────────────────────────────── détection réseau ───────────────────────────────
detect_ips() {
  # toutes les adresses IPv4 non-loopback
  mapfile -t ALL_IPS < <(ip -4 addr show scope global 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || true)
  # interfaces VPN connues (adresse IPv4 complète — 4 octets)
  NETBIRD_IP=$(ip -4 addr show wt0 2>/dev/null | grep -oP '(?<=inet\s)100(\.\d+){3}' || true)
  TAILSCALE_IP=$(ip -4 addr show tailscale0 2>/dev/null | grep -oP '(?<=inet\s)100(\.\d+){3}' || true)
}

is_public() {
  # mesh VPN (NetBird/Tailscale: 100.64.0.0/10) et RFC1918 = privé
  # NOTE ERE: pas de \d en bash [[ =~ ]] — [0-9] obligatoire
  local ip="$1"
  [[ "$ip" =~ ^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\.|^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\. ]] && return 1
  return 0
}

is_vpn() {
  local ip="$1"
  [[ "$ip" == "$NETBIRD_IP" || "$ip" == "$TAILSCALE_IP" ]]
}

port_free() { ss -tln 2>/dev/null | grep -q ":$1 " && return 1 || return 0; }

# ─────────────────────────────── TUI helpers ───────────────────────────────
confirm() {
  local msg="$1" def="${2:-n}" answer
  read -rp "$(printf "${bold}%s${reset} ${dim}[y/N]${reset} " "$msg")" answer || answer=""
  answer="${answer:-$def}"
  [[ "$answer" =~ ^[Yy] ]]
}

# tty_read: prompt qui marche aussi en pipe (curl | bash) — lit sur /dev/tty.
# Résultat dans TTY_ANSWER (vide si pas de tty ou EOF → défauts appliqués).
# stderr redirigée: sans tty, read n'imprime pas d'erreur.
TTY_ANSWER=""
tty_read() {
  TTY_ANSWER=""
  if [[ -r /dev/tty ]]; then
    read -rp "$1" TTY_ANSWER 2>/dev/null < /dev/tty || TTY_ANSWER=""
  fi
}

ask_ip() {
  # mode automatisé: variable d'env
  if [[ -n "${KERVIA_VAULT_BIND:-}" ]]; then
    BIND_IP="$KERVIA_VAULT_BIND"
    if is_public "$BIND_IP"; then
      err "KERVIA_VAULT_BIND=$BIND_IP est une IP publique — refuse en mode automatisé (utilise l'IP VPN ou une IP privée)"
    fi
    say "Bind (env KERVIA_VAULT_BIND) : ${BIND_IP}"
    return
  fi
  printf "\n"
  say "Adresses détectées sur cette machine :"
  local i=1 choice
  local IPS=()
  for ip in "${ALL_IPS[@]}"; do
    local label=""
    if [[ "$ip" == "$NETBIRD_IP" ]]; then label=" ${green}(NetBird ✓)${reset}"
    elif [[ "$ip" == "$TAILSCALE_IP" ]]; then label=" ${green}(Tailscale ✓)${reset}"
    elif is_public "$ip"; then label=" ${red}(PUBLIQUE)${reset}"
    else label=" ${dim}(privée)${reset}"; fi
    printf "  ${bold}[%d]${reset} %s%s\n" "$i" "$ip" "$label"
    IPS+=("$ip"); i=$((i+1))
  done
  # suggestion intelligente : VPN > privée (jamais publique)
  local suggested=1
  for idx in "${!IPS[@]}"; do
    if is_vpn "${IPS[$idx]}"; then suggested=$((idx+1)); break; fi
  done
  for idx in "${!IPS[@]}"; do
    if ! is_vpn "${IPS[$idx]}" && ! is_public "${IPS[$idx]}"; then suggested=$((idx+1)); break; fi
  done
  printf "\n"
  tty_read "$(printf "Bind Kervia-vault sur ${bold}[%d]${reset} ${dim}(Entrée = suggestion)${reset} : " "$suggested")"
  choice="${TTY_ANSWER:-$suggested}"
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#IPS[@]} )); then
    err "Choix invalide"
  fi
  BIND_IP="${IPS[$((choice-1))]}"
  # avertissement public
  if is_public "$BIND_IP"; then
    printf "\n"
    printf "%b" "${red}${bold}⚠ ATTENTION : Kervia-vault sera exposé sur INTERNET (${BIND_IP}).${reset}\n"
    printf "%b" "${red}Un coffre de secrets exposé publiquement est un risque CRITIQUE si l'URL fuite.${reset}\n"
    printf "%b" "${dim}Recommandation : NetBird/Tailscale → bind sur l'IP VPN (100.x) ; sinon IP privée + reverse proxy TLS.${reset}\n"
    tty_read "$(printf '%s%s%s' "${bold}" "Je comprends le risque et je veux binder sur cette IP publique" "${reset} ${dim}[y/N]${reset} ")"
    [[ "${TTY_ANSWER:-n}" =~ ^[Yy] ]] || err "Installation annulée — c'était le bon choix."
  fi
  say "Écoute sur : ${BIND_IP}"
}

ask_port() {
  local port="${KERVIA_VAULT_PORT:-$DEFAULT_PORT}"
  if [[ -n "${KERVIA_VAULT_PORT:-}" ]]; then
    port_free "$port" || err "Port $port déjà utilisé (KERVIA_VAULT_PORT)"
    PORT="$port"; say "Port (env KERVIA_VAULT_PORT) : ${PORT}"; return
  fi
  while true; do
    tty_read "$(printf "Port ${dim}[défaut: %s]${reset} : " "$port")"
    local input="${TTY_ANSWER:-$port}"
    if port_free "$input"; then PORT="$input"; break
    else warn "Port $input déjà utilisé — choisis-en un autre."; fi
  done
  say "Port : ${PORT}"
}

# ─────────────────────────────── binaire ───────────────────────────────
download_binary() {
  say "Téléchargement du binaire…"
  local arch tmpdir
  case "$(uname -m)" in
    x86_64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) err "Architecture non supportée: $(uname -m)" ;;
  esac
  tmpdir="$(mktemp -d /tmp/kervia-vault.XXXXXX)" || err "mktemp a échoué"
  local url="$GITHUB_RELEASES/download/kervia-vault-linux-${arch}.tar.gz"
  local sumurl="$GITHUB_RELEASES/download/kervia-vault_checksums.txt"
  local tarname="kervia-vault-linux-${arch}.tar.gz"
  if ! curl -sfL "$url" -o "$tmpdir/$tarname"; then
    err "Échec du téléchargement. Vérifie ta connexion : $url"
  fi
  if ! curl -sfL "$sumurl" -o "$tmpdir/checksums.txt"; then
    err "Échec du téléchargement des checksums : $sumurl"
  fi
  # sha256 obligatoire : un installeur root ne pose jamais un binaire non vérifié
  ( cd "$tmpdir" && grep "$tarname" checksums.txt | sha256sum -c - ) \
    || err "Checksum INVALIDE — le binaire ne correspond pas à la signature de la release. Abandon."
  tar -xzf "$tmpdir/$tarname" -C "$tmpdir"
  install -m 755 "$tmpdir/kervia-vault" "$INSTALL_DIR/$BIN_NAME"
  rm -rf "$tmpdir"
  say "Binaire installé et vérifié : ${INSTALL_DIR}/${BIN_NAME}"
}

# ─────────────────────────────── systemd ───────────────────────────────
install_service() {
  MASTER_KEY=$(openssl rand -hex 32)
  mkdir -p "$DATA_DIR" "$DATA_DIR/bin"
  chmod 700 "$DATA_DIR"
  # utilisateur système dédié — le service n'a pas besoin de root (port >1024,
  # seul DATA_DIR est écrit)
  if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
  chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
  # le binaire vit dans le StateDirectory (la self-update peut écrire SON
  # propre binaire) — /usr/local/bin ne garde qu'un symlink root-owned
  mv "$INSTALL_DIR/$BIN_NAME" "$DATA_DIR/bin/$BIN_NAME"
  chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR/bin/$BIN_NAME"
  ln -sfn "$DATA_DIR/bin/$BIN_NAME" "$INSTALL_DIR/$BIN_NAME"
  # hash placeholder PUBLIC pour le premier boot — le wizard le remplace au
  # premier lancement (mode first-boot: /setup/init n'est ouvert que si le
  # hash effectif est encore ce placeholder)
  ADMIN_HASH=$("$DATA_DIR/bin/$BIN_NAME" hashpw "$PLACEHOLDER")
  cat > "/etc/systemd/system/${SERVICE}.service" << EOF
[Unit]
Description=Kervia-vault — multi-agent secrets vault
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=KERVIA_VAULT_MASTER_KEY=${MASTER_KEY}
Environment=KERVIA_VAULT_ADMIN_HASH=${ADMIN_HASH}
Environment=KERVIA_VAULT_LISTEN=${BIND_IP}:${PORT}
Environment=KERVIA_VAULT_DB=${DATA_DIR}/kervia-vault.db
ExecStart=${DATA_DIR}/bin/${BIN_NAME}
# always (pas on-failure): la self-update quitte proprement (exit 0) et
# systemd relance le NOUVEAU binaire
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DATA_DIR}
User=${SERVICE_USER}
Group=${SERVICE_USER}

[Install]
WantedBy=multi-user.target
EOF
  chmod 600 "/etc/systemd/system/${SERVICE}.service"
  systemctl daemon-reload
  systemctl enable --now "$SERVICE"
  say "Service systemd activé (utilisateur ${SERVICE_USER})"
}

# ─────────────────────────────── main ───────────────────────────────
[[ $EUID -eq 0 ]] || err "Lance ce script en root (sudo)"
command -v ss >/dev/null || err "iproute2 requis (ss)"
command -v openssl >/dev/null || err "openssl requis"
command -v useradd >/dev/null || err "useradd requis (shadow-utils)"
command -v sha256sum >/dev/null || err "sha256sum requis (coreutils)"

printf "%b" "${bold}"
cat << 'BANNER'
     _    ____  __  __         _   __         ____
    / \  |  _ \|  \/  | __ _  / | / / __   __/ ___| _   _ _ __  ___
   / _ \ | |_) | |\/| |/ _` | | |/ / __| '_ \___ \| | | | '_ \/ __|
  / ___ \|  __/| |  | | (_| | |   < (_| | | |___) | |_| | |_) \__ \
 /_/   \_\_|   |_|  |_|\__,_| |_|\_\__,_|_| |____/ \__,_| .__/|___/
                                                        |_|
BANNER
printf "%b" "${reset}"

detect_ips
[[ ${#ALL_IPS[@]} -gt 0 ]] || err "Aucune adresse IPv4 détectée"

ask_ip
ask_port
download_binary
install_service

# URL finale
if [[ "$BIND_IP" == "0.0.0.0" ]]; then URL="http://localhost:${PORT}"
else URL="http://${BIND_IP}:${PORT}"; fi

sleep 1
printf "\n"
printf "%b" "${green}${bold}─────────── INSTALLATION TERMINÉE ───────────${reset}\n\n"
printf "Kervia-vault écoute sur : ${bold}%s${reset}\n" "$URL"
printf "%b" "${dim}Le wizard s'ouvrira au premier lancement dans ton navigateur :${reset}\n"
printf "  ${bold}→ %s/ui/${reset}\n\n" "$URL"
printf "Tu y configureras : mot de passe admin → codes de récupération → premier agent + skill\n\n"
printf "%b" "${dim}Commandes : systemctl status|stop|restart kervia-vault · journal : journalctl -u kervia-vault -f${reset}\n"
printf "%b" "${dim}La MASTER KEY est dans /etc/systemd/system/${SERVICE}.service — backup-la maintenant si tu veux (${orange}requis pour restaurer les secrets${reset}).${reset}\n"