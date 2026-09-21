#!/bin/bash
# Kervia-vault installer — binaire + systemd + wizard web
# Usage: curl -sL <url>/install.sh | bash   (ou: bash install.sh)
set -euo pipefail

VERSION="1.0"
BIN_NAME="kervia-vault"
INSTALL_DIR="/usr/local/bin"
DATA_DIR="/var/lib/kervia-vault"
SERVICE="kervia-vault"
DEFAULT_PORT="8321"
GITHUB_RELEASES="https://github.com/kerviaHerve/kervia-vault/releases/latest"

bold="\033[1m"; dim="\033[2m"; red="\033[0;31m"; green="\033[0;32m"; orange="\033[0;33m"; reset="\033[0m"

say()  { printf "${bold}▸${reset} %s\n" "$1"; }
warn() { printf "${orange}⚠ %s${reset}\n" "$1"; }
err()  { printf "${red}✗ %s${reset}\n" "$1"; exit 1; }

# ─────────────────────────────── détection réseau ───────────────────────────────
detect_ips() {
  # toutes les adresses IPv4 non-loopback
  mapfile -t ALL_IPS < <(ip -4 addr show scope global 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || true)
  # IP par défaut (route)
  DEFAULT_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP '(?<=src\s)\d+(\.\d+){3}' || echo "")
  # interfaces VPN connues
  NETBIRD_IP=$(ip -4 addr show wt0 2>/dev/null | grep -oP '(?<=inet\s)100\.\d+' || echo "")
  TAILSCALE_IP=$(ip -4 addr show tailscale0 2>/dev/null | grep -oP '(?<=inet\s)100\.\d+(\.\d+){3}' || echo "")
}

is_public() {
  # RFC1918 + CGNAT = privé
  local ip="$1"
  [[ "$ip" =~ ^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\. ]] && return 1
  return 0
}

port_free() { ss -tln 2>/dev/null | grep -q ":$1 " && return 1 || return 0; }

# ─────────────────────────────── TUI helpers ───────────────────────────────
confirm() {
  local msg="$1" def="${2:-n}" answer
  read -rp "$(printf "${bold}%s${reset} ${dim}[y/N]${reset} " "$msg")" answer || answer=""
  answer="${answer:-$def}"
  [[ "$answer" =~ ^[Yy] ]]
}

ask_ip() {
  echo ""
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
  # suggestion intelligente
  local suggested=1
  for idx in "${!IPS[@]}"; do
    if [[ "${IPS[$idx]}" == "$NETBIRD_IP" || "${IPS[$idx]}" == "$TAILSCALE_IP" ]]; then suggested=$((idx+1)); break; fi
  done
  for idx in "${!IPS[@]}"; do
    if [[ "${IPS[$idx]}" != "$NETBIRD_IP" && "${IPS[$idx]}" != "$TAILSCALE_IP" ]] && ! is_public "${IPS[$idx]}"; then suggested=$((idx+1)); break; fi
  done
  echo ""
  read -rp "$(printf "Bind Kervia-vault sur ${bold}[%d]${reset} ${dim}(Entrée = suggestion)${reset} : " "$suggested")" choice
  choice="${choice:-$suggested}"
  BIND_IP="${IPS[$((choice-1))]}" || err "Choix invalide"
  # avertissement public
  if is_public "$BIND_IP"; then
    echo ""
    printf "${red}${bold}⚠ ATTENTION : Kervia-vault sera exposé sur INTERNET (${BIND_IP}).${reset}\n"
    printf "${red}Un coffre de secrets exposé publiquement est un risque CRITIQUE si l'URL fuite.${reset}\n"
    printf "${dim}Recommandation : NetBird/Tailscale → bind sur l'IP VPN (100.x) ; sinon IP privée + reverse proxy TLS.${reset}\n"
    confirm "Je comprends le risque et je veux binder sur cette IP publique" "n" || err "Installation annulée — c'était le bon choix."
  fi
  say "Écoute sur : ${BIND_IP}"
}

ask_port() {
  local port="$DEFAULT_PORT"
  while true; do
    read -rp "$(printf "Port ${dim}[défaut: %s]${reset} : " "$port")" input
    input="${input:-$port}"
    if port_free "$input"; then PORT="$input"; break
    else warn "Port $input déjà utilisé — choisis-en un autre."; fi
  done
  say "Port : ${PORT}"
}

# ─────────────────────────────── binaire ───────────────────────────────
download_binary() {
  say "Téléchargement du binaire…"
  local arch
  case "$(uname -m)" in
    x86_64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) err "Architecture non supportée: $(uname -m)" ;;
  esac
  local url="$GITHUB_RELEASES/download/kervia-vault-linux-${arch}.tar.gz"
  if ! curl -sfL "$url" -o /tmp/kervia-vault.tar.gz 2>/dev/null; then
    err "Échec du téléchargement. Vérifie ta connexion : $url"
  fi
  tar -xzf /tmp/kervia-vault.tar.gz -C /tmp
  install -m 755 /tmp/kervia-vault "$INSTALL_DIR/$BIN_NAME"
  rm -f /tmp/kervia-vault.tar.gz /tmp/kervia-vault
  say "Binaire installé : ${INSTALL_DIR}/${BIN_NAME}"
}

# ─────────────────────────────── systemd ───────────────────────────────
install_service() {
  MASTER_KEY=$(openssl rand -hex 32)
  mkdir -p "$DATA_DIR"
  chmod 700 "$DATA_DIR"
  # hash temporaire pour que le serveur démarre — le wizard le remplace
  ADMIN_HASH=$("$INSTALL_DIR/$BIN_NAME" hashpw "setup-placeholder")
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
ExecStart=${INSTALL_DIR}/${BIN_NAME}
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${DATA_DIR}
User=root

[Install]
WantedBy=multi-user.target
EOF
  chmod 600 "/etc/systemd/system/${SERVICE}.service"
  systemctl daemon-reload
  systemctl enable --now "$SERVICE"
  say "Service systemd activé"
}

# ─────────────────────────────── main ───────────────────────────────
[[ $EUID -eq 0 ]] || err "Lance ce script en root (sudo)"
command -v ss >/dev/null || err "iproute2 requis (ss)"
command -v openssl >/dev/null || err "openssl requis"

printf "${bold}"
cat << 'BANNER'
     _    ____  __  __         _   __         ____
    / \  |  _ \|  \/  | __ _  / | / / __   __/ ___| _   _ _ __  ___
   / _ \ | |_) | |\/| |/ _` | | |/ / __| '_ \___ \| | | | '_ \/ __|
  / ___ \|  __/| |  | | (_| | |   < (_| | | |___) | |_| | |_) \__ \
 /_/   \_\_|   |_|  |_|\__,_| |_|\_\__,_|_| |____/ \__,_| .__/|___/
                                                        |_|
BANNER
printf "${reset}"

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
echo ""
printf "${green}${bold}─────────── INSTALLATION TERMINÉE ───────────${reset}\n\n"
printf "Kervia-vault écoute sur : ${bold}${URL}${reset}\n"
printf "${dim}Le wizard s'ouvrira au premier lancement dans ton navigateur :${reset}\n"
printf "  ${bold}→ ${URL}/ui/${reset}\n\n"
printf "Tu y configureras : mot de passe admin → codes de récupération → premier agent + skill\n\n"
printf "${dim}Commandes : systemctl status|stop|restart kervia-vault · journal : journalctl -u kervia-vault -f${reset}\n"
printf "${dim}La MASTER KEY est dans /etc/systemd/system/${SERVICE}.service — backup-la maintenant si tu veux (${orange}requis pour restaurer les secrets${reset}).${reset}\n"