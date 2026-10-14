#!/usr/bin/env python3
"""kervia-vault MCP stdio→HTTP proxy.

Bridges an MCP stdio client (OpenCode) to the Kervia-vault streamable HTTP
endpoint. The API key is read at startup from a 0600 file (default /ag)
and sent as a Bearer header — it never lands in a config file, in argv
or in a stored document (Rita's rule).

Protocol: line-delimited JSON-RPC on stdin/stdout; each request is
POSTed to the server's /mcp endpoint with the session header when the
server issues one. MCP notifications from the server are not streamed
back (request/response proxying only, sufficient for OpenCode's use).
"""
import json
import os
import sys
import urllib.request

KEY_FILE = os.environ.get("AG_VAULT_KEY_FILE", "/ag")
BASE_URL = os.environ.get("AG_VAULT_URL", "http://100.100.108.242:8321")

def load_key():
    try:
        with open(KEY_FILE) as f:
            key = f.read().strip()
    except OSError as e:
        sys.stderr.write(f"kervia-vault-proxy: cannot read {KEY_FILE}: {e}\n")
        sys.exit(1)
    if not key.startswith("av_"):
        sys.stderr.write("kervia-vault-proxy: key file does not contain an av_ key\n")
        sys.exit(1)
    return key

def main():
    key = load_key()
    session_id = None
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        req = urllib.request.Request(
            BASE_URL + "/mcp",
            data=line.encode(),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "Authorization": f"Bearer {key}",
                **({"Mcp-Session-Id": session_id} if session_id else {}),
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                sid = r.headers.get("Mcp-Session-Id")
                if sid:
                    session_id = sid
                ct = r.headers.get("Content-Type", "")
                body = r.read().decode()
        except urllib.error.HTTPError as e:
            # 401 avec une session en cache : le serveur a redémarré —
            # on jette la session périmée et on rejoue UNE fois sans elle.
            if e.code == 401 and session_id:
                session_id = None
                retry = urllib.request.Request(
                    BASE_URL + "/mcp",
                    data=line.encode(),
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json, text/event-stream",
                        "Authorization": f"Bearer {key}",
                    },
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(retry, timeout=120) as r:
                        sid = r.headers.get("Mcp-Session-Id")
                        if sid:
                            session_id = sid
                        ct = r.headers.get("Content-Type", "")
                        body = r.read().decode()
                except Exception as e2:  # noqa: BLE001 — proxy must never crash
                    out = {"jsonrpc": "2.0", "id": msg.get("id"),
                           "error": {"code": -32000, "message": f"retry: {e2}"}}
                    sys.stdout.write(json.dumps(out) + "\n")
                    sys.stdout.flush()
                    continue
            else:
                err = e.read().decode(errors="replace")[:200]
                out = {"jsonrpc": "2.0", "id": msg.get("id"),
                       "error": {"code": -32000, "message": f"HTTP {e.code}: {err}"}}
                sys.stdout.write(json.dumps(out) + "\n")
                sys.stdout.flush()
                continue
        except Exception as e:  # noqa: BLE001 — proxy must never crash the client
            out = {"jsonrpc": "2.0", "id": msg.get("id"),
                   "error": {"code": -32000, "message": f"proxy: {e}"}}
            sys.stdout.write(json.dumps(out) + "\n")
            sys.stdout.flush()
            continue
        # streamable HTTP: the reply may be a JSON body or an SSE stream
        if "text/event-stream" in ct:
            for ev in body.splitlines():
                if ev.startswith("data:"):
                    payload = ev[5:].strip()
                    if payload:
                        sys.stdout.write(payload + "\n")
        else:
            sys.stdout.write(body.strip() + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()