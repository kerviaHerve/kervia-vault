// Ephemeral one-time share links — the API side.
//
// Flow: an admin mints a link for one secret (POST /admin/secrets/{id}/share,
// TTL bounded); the token is 32 CSPRNG bytes returned ONCE. Anyone with the
// link GETs /share/{token}: the page reveals the value exactly once, then the
// link is dead. Consumed/expired/unknown links render the SAME page —
// enumeration learns nothing. The page is standalone: zero JS (CSP-proof),
// no-store, deny-frame.
//
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/kerviaHerve/kervia-vault/internal/model"
)

// ShareTTL bounds : 1 minute plancher (pas de lien à vie trop courte),
// 24 h plafond.
const (
	ShareTTLDefault = 30 * time.Minute
	ShareTTLFloor   = time.Minute
	ShareTTLMax     = 24 * time.Hour
)

// ShareSecret (admin) : POST /admin/secrets/{id}/share {ttl_minutes}.
// Réponse une seule fois : {"url", "expires_at"}.
func (a *AdminServer) ShareSecret(w http.ResponseWriter, r *http.Request) {
	id, ok := adminSecretIDFromPath(r.URL.Path)
	if !ok {
		writeErr(w, 400, "invalid_request", "")
		return
	}
	var req struct {
		TTLMinutes int `json:"ttl_minutes"`
	}
	_ = jsonBodyN(r, &req, 1<<10) // champ optionnel — absents = défaut

	ttl := ShareTTLDefault
	if req.TTLMinutes > 0 {
		ttl = time.Duration(req.TTLMinutes) * time.Minute
	}
	if ttl < ShareTTLFloor {
		ttl = ShareTTLFloor
	}
	if ttl > ShareTTLMax {
		ttl = ShareTTLMax
	}

	// le secret doit exister (et être déchiffrable) avant de mouler un lien
	if _, _, _, err := a.store.GetSecretByID(id); err != nil {
		writeErr(w, 404, "secret_not_found", "")
		return
	}

	raw := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	token := hex.EncodeToString(raw)
	sum := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(sum[:])

	expires := time.Now().Add(ttl)
	if err := a.store.CreateShare(uuid.NewString(), tokenHash, id, "admin", expires); err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	_ = a.store.AppendAuditDetail("admin", model.AuditShareCreate, "secret/"+id,
		"ttl="+strconv.Itoa(int(ttl/time.Minute))+"m", requestAuditInfo(r, 200))
	writeJSON(w, 200, map[string]any{
		"url":        "/share/" + token,
		"expires_at": expires.UTC().Format(time.RFC3339),
	})
}

// ViewShare (public) : GET /share/{token} — page autonome sans JS.
func (a *AdminServer) ViewShare(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.URL.Path, "/share/")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")

	// format : 64 hex exactement, sans slash — sinon réponse générique
	if len(token) != 64 || strings.Contains(token, "/") {
		shareGonePage(w)
		return
	}
	sum := sha256.Sum256([]byte(token))
	secretID, err := a.store.ConsumeShare(hex.EncodeToString(sum[:]))
	if err != nil {
		shareAudit(a, r, "", false)
		shareGonePage(w)
		return
	}

	sec, nonce, ct, err := a.store.GetSecretByID(secretID)
	if err != nil {
		shareAudit(a, r, secretID, false)
		shareGonePage(w)
		return
	}
	val, err := a.enc.Decrypt(nonce, ct)
	if err != nil {
		shareAudit(a, r, secretID, false)
		shareGonePage(w)
		return
	}
	shareAudit(a, r, secretID, true)
	vaultName := ""
	if v, err := a.store.GetVaultNameByID(sec.VaultID); err == nil {
		vaultName = v
	}
	shareValuePage(w, sec.Key, vaultName, string(val))
}

// shareAudit journalise la consultation — le token n'apparaît JAMAIS.
func shareAudit(a *AdminServer, r *http.Request, secretID string, ok bool) {
	if secretID == "" {
		return // token inconnu — rien d'intéressant à tracer au-delà des logs HTTP
	}
	if ok {
		_ = a.store.AppendAuditDetail("admin", model.AuditShareView, "secret/"+secretID,
			"ip="+clientIPForShare(r), requestAuditInfo(r, 200))
	}
}

func clientIPForShare(r *http.Request) string {
	// best effort — derrière un reverse proxy, RemoteAddr reste la source honnête
	if host := r.RemoteAddr; host != "" {
		if i := strings.LastIndex(host, ":"); i > 0 {
			return host[:i]
		}
		return host
	}
	return "?"
}

// adminSecretIDFromPath : /admin/secrets/{id}/share — id strict [a-f0-9-],
// aucun traversal (même garde que secretIDFromPath).
func adminSecretIDFromPath(p string) (string, bool) {
	parts := strings.Split(strings.Trim(p, "/"), "/")
	if len(parts) != 4 || parts[0] != "admin" || parts[1] != "secrets" || parts[3] != "share" {
		return "", false
	}
	id := parts[2]
	if len(id) == 0 || len(id) > 64 {
		return "", false
	}
	for _, c := range id {
		if (c < 'a' || c > 'f') && (c < '0' || c > '9') && c != '-' {
			return "", false
		}
	}
	return id, true
}

// sharePageStyle : palette Kervia (tokens v1.0.0), page autonome — aucun
// asset externe, aucun script.
const sharePageStyle = `<style>
:root{color-scheme:dark}
*{margin:0;padding:0;box-sizing:border-box}
body{background:#171B19;color:#F4F5F1;font:15px/1.6 "Space Grotesk",system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:100%;max-width:520px;background:#222A25;border:1px solid #3A483F;border-radius:16px;padding:32px}
h1{font-size:17px;letter-spacing:-0.01em;margin-bottom:4px}
p.sub{color:#A5B5AA;font-size:12px;margin-bottom:24px}
.value{background:#171B19;border:1px solid #3A483F;border-radius:10px;padding:16px;margin:12px 0 24px;user-select:all}
pre{font:13px/1.7 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all}
.meta{display:flex;justify-content:space-between;color:#A5B5AA;font-size:11px;margin-bottom:12px}
.warn{color:#F1C28C;font-size:11px;margin-bottom:24px}
.dead{color:#A5B5AA;text-align:center}
footer{margin-top:24px;text-align:center;color:#586A5D;font-size:10px}
</style>`

func sharePageShell(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// #nosec G705 -- XSS sink by construction, but every variable fragment
	// goes through escapeHTML first (key, vault, value) — the rest is our
	// own static template. Same rationale as the v1.0.11 reveal-page fix.
	_, _ = io.WriteString(w, `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">`+
		`<meta name="viewport" content="width=device-width,initial-scale=1">`+
		`<meta name="robots" content="noindex,nofollow">`+
		`<title>Kervia-vault</title>`+sharePageStyle+`</head><body><main>`+body+
		`<footer>Kervia-vault</footer></main></body></html>`)
}

// shareValuePage : la révélation unique — bilingue, le lecteur peut ne pas
// parler la langue de l'admin.
func shareValuePage(w http.ResponseWriter, key, vault, value string) {
	sharePageShell(w, `<h1>Secret partagé · Shared secret</h1>`+
		`<p class="sub">Ce lien s'autodétruit après cette consultation · This link self-destructs after this view</p>`+
		`<div class="meta"><span>`+escapeHTML(key)+`</span><span>`+escapeHTML(vault)+`</span></div>`+
		`<div class="value"><pre>`+escapeHTML(value)+`</pre></div>`+
		`<p class="warn">Copiez la valeur maintenant — rafraîchir ne la montrera plus.</p>`+
		`<p class="warn">Copy the value now — refreshing will not show it again.</p>`)
}

// shareGonePage : consommé, expiré ou inconnu — même page, pas d'oracle.
func shareGonePage(w http.ResponseWriter) {
	sharePageShell(w, `<h1>Lien expiré · Link expired</h1>`+
		`<p class="dead">Ce lien a déjà été consulté, a expiré, ou n'a jamais existé.<br>`+
		`This link was already viewed, has expired, or never existed.</p>`)
}

// escapeHTML : rendu sûr d'une valeur arbitraire (pas d'XSS dans la page
// publique — le contenu vient d'un secret, traité comme non fiable).
func escapeHTML(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&#34;", "'", "&#39;")
	return r.Replace(s)
}