#!/usr/bin/env python3
"""Attend la signature AMO d'une version d'extension, puis l'installe.

Après un `scripts/amo-sign-extension.sh`, AMO place la version en file
d'approbation (même en unlisted, comportement 2025+) : le XPI signé
n'est téléchargeable qu'après traitement (jusqu'à 24 h). Ce veilleur
interroge l'API v5, télécharge le fichier dès qu'il contient la
signature Mozilla (META-INF), et l'installe à l'emplacement voulu
(atomic : tmp + rename) — la webui le servira à la requête suivante,
sans redémarrage (override data dir de internal/web).

Identifiants JWT lus dans kervia-vault (REST /v1) — jamais affichés.

Usage :
  scripts/amo-await-signed.py --guid <amo-guid> --version <version-id> \
      [--out /var/lib/kervia-vault/extension-firefox.xpi] \
      [--interval 300] [--timeout 172800]

Codes retour : 0 = signé et installé ; 3 = délai dépassé non signé.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import tempfile
import time
import urllib.request
import urllib.error
import zipfile

VAULT_URL = os.environ.get("AG_VAULT_URL", "http://100.100.108.242:8321")
VAULT_NAME = os.environ.get("AG_VAULT_NAME", "hermes")
KEY_FILE = os.environ.get("AG_VAULT_KEY_FILE", "/ag")
AMO_API = "https://addons.mozilla.org/api/v5"

# Fichiers de signature Mozilla dans un XPI signé (zigbert / PKCS#7).
SIGNATURE_MARKERS = ("META-INF/mozilla.rsa", "META-INF/zigbert.rsa")


def log(msg: str) -> None:
    print(time.strftime("[%Y-%m-%d %H:%M:%S] ") + msg, flush=True)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def vault_amo_creds():
    with open(KEY_FILE) as f:
        key = f.read().strip()
    req = urllib.request.Request(
        f"{VAULT_URL}/v1/secrets?vault={VAULT_NAME}",
        headers={"Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        entries = json.load(r)
    entry = [
        e for e in entries
        if e["key"].startswith("user:") and e["key"].count(":") == 2
    ][0]
    req = urllib.request.Request(
        f"{VAULT_URL}/v1/secrets/{entry['id']}",
        headers={"Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        detail = json.load(r)
    return detail["key"], detail["value"]


def jwt(issuer: str, secret: str) -> str:
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    now = int(time.time())
    # AMO impose des JWT très courts : exp - iat <= 60 s
    payload = b64url(json.dumps({"iss": issuer, "iat": now, "exp": now + 55}).encode())
    signing_input = f"{header}.{payload}".encode()
    sig = b64url(hmac.new(secret.encode(), signing_input, hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def fetch(token: str, url: str, dest: str) -> None:
    req = urllib.request.Request(
        url, headers={"Authorization": f"JWT {token}", "Accept": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        blob = r.read()
    with open(dest, "wb") as out:
        out.write(blob)


def version_info(token: str, guid: str, version_id: str) -> dict:
    req = urllib.request.Request(
        f"{AMO_API}/addons/addon/{guid}/versions/{version_id}/",
        headers={"Authorization": f"JWT {token}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def is_signed(xpi_path: str) -> bool:
    try:
        with zipfile.ZipFile(xpi_path) as z:
            names = set(z.namelist())
            return any(m in names for m in SIGNATURE_MARKERS)
    except zipfile.BadZipFile:
        return False


def install(src: str, out: str) -> None:
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(out) or ".",
                               prefix=".amo-signed-", suffix=".xpi")
    os.close(fd)
    with open(src, "rb") as fsrc, open(tmp, "wb") as fdst:
        fdst.write(fsrc.read())
    os.chmod(tmp, 0o644)
    os.replace(tmp, out)  # atomique — servi à la requête suivante


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--guid", required=True)
    ap.add_argument("--version", required=True)
    ap.add_argument("--out", default="/var/lib/kervia-vault/extension-firefox.xpi")
    ap.add_argument("--interval", type=int, default=300)
    ap.add_argument("--timeout", type=int, default=172800)
    args = ap.parse_args()

    issuer, secret = vault_amo_creds()
    deadline = time.time() + args.timeout
    log(f"veille sur le module {args.guid}, version AMO {args.version} "
        f"(toutes les {args.interval} s, {args.timeout} s max)")

    attempt = 0
    while time.time() < deadline:
        attempt += 1
        try:
            token = jwt(issuer, secret)
            info = version_info(token, args.guid, args.version)
            f = info.get("file") or {}
            url = f.get("url") or ""
            status = f.get("status")
            if not url:
                log(f"#{attempt} pas encore de fichier (statut {status})")
            else:
                with tempfile.NamedTemporaryFile(suffix=".xpi", delete=False) as t:
                    tmp = t.name
                try:
                    fetch(token, url, tmp)
                    if is_signed(tmp):
                        install(tmp, args.out)
                        log(f"#{attempt} SIGNÉ ✓ — installé : {args.out} "
                            f"(statut AMO {status})")
                        return 0
                    log(f"#{attempt} fichier présent mais non signé (statut {status})")
                finally:
                    try:
                        os.unlink(tmp)
                    except FileNotFoundError:
                        pass
        except urllib.error.HTTPError as e:
            log(f"#{attempt} HTTP {e.code} — nouveau essai")
        except Exception as e:  # noqa: BLE001 — le veilleur ne doit jamais crasher
            log(f"#{attempt} erreur : {e}")
        time.sleep(args.interval)

    log("délai dépassé — la version AMO n'est toujours pas signée")
    return 3


if __name__ == "__main__":
    sys.exit(main())