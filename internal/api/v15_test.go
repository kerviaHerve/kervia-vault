// v1.5 feature integration tests — the NEW attack surfaces, end-to-end:
//   - share links: one-time semantics, uniform gone-page (no oracle), XSS escaping
//   - TOTP: enroll/confirm/login flow, uniform failure, public status
//   - export/restore: KVX1 round trip, the "deleted vault" accident, skip semantics
//
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
)

// ─── share links ─────────────────────────────────────────────────────────────

func TestShareLinkOneTime(t *testing.T) {
	env, _, _ := newTestEnv(t)
	env.postJSON("/admin/secrets", map[string]any{"vault": "rita-vault", "key": "SHARED", "value": "one-time-value"})

	list := listSecrets(t, env, "rita-vault")
	if len(list) != 1 {
		t.Fatalf("want 1 secret, got %d", len(list))
	}

	// mint the link (TTL dans les bornes)
	res := env.postJSON("/admin/secrets/"+list[0].ID+"/share", map[string]any{"ttl_minutes": 15})
	if res.StatusCode != 200 {
		t.Fatalf("share: %d", res.StatusCode)
	}
	var share struct {
		URL string `json:"url"`
	}
	_ = json.NewDecoder(res.Body).Decode(&share)
	res.Body.Close()
	if !strings.HasPrefix(share.URL, "/share/") || len(share.URL) != len("/share/")+64 {
		t.Fatalf("bad share url: %q", share.URL)
	}

	// view 1 : la valeur EST révélée, une fois, et la page ne se met jamais en cache
	r1, _ := http.Get(env.srv.URL + share.URL)
	b1, _ := io.ReadAll(r1.Body)
	r1.Body.Close()
	if r1.StatusCode != 200 || !strings.Contains(string(b1), "one-time-value") {
		t.Fatal("first view must disclose the value")
	}
	if r1.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("share page cache-control = %q, want no-store", r1.Header.Get("Cache-Control"))
	}

	// view 2 : morte, même page
	r2, _ := http.Get(env.srv.URL + share.URL)
	b2, _ := io.ReadAll(r2.Body)
	r2.Body.Close()
	if strings.Contains(string(b2), "one-time-value") || !strings.Contains(string(b2), "Link expired") {
		t.Fatal("second view must show the gone page, never the value")
	}

	// token inconnu : la MÊME page — l'énumération n'apprend rien
	r3, _ := http.Get(env.srv.URL + "/share/" + strings.Repeat("a", 64))
	b3, _ := io.ReadAll(r3.Body)
	r3.Body.Close()
	if !strings.Contains(string(b3), "Link expired") || strings.Contains(string(b3), "one-time-value") {
		t.Fatal("garbage token must render the same gone page")
	}
	if string(b2) != string(b3) {
		t.Fatal("gone page (consumed) and gone page (unknown) must be IDENTICAL")
	}

	// XSS : une valeur de secret contenant du HTML doit être échappée sur la page
	env.postJSON("/admin/secrets", map[string]any{"vault": "rita-vault", "key": "XSS", "value": `<script>alert(1)</script>`})
	list = listSecrets(t, env, "rita-vault")
	res = env.postJSON("/admin/secrets/"+list[1].ID+"/share", map[string]any{"ttl_minutes": 15})
	var share2 struct {
		URL string `json:"url"`
	}
	_ = json.NewDecoder(res.Body).Decode(&share2)
	res.Body.Close()
	r4, _ := http.Get(env.srv.URL + share2.URL)
	b4, _ := io.ReadAll(r4.Body)
	r4.Body.Close()
	if strings.Contains(string(b4), "<script>") {
		t.Fatal("the share page must HTML-escape secret values")
	}
	if !strings.Contains(string(b4), "&lt;script&gt;") {
		t.Fatal("escaped form expected on the page")
	}
}

// listSecrets : ids d'un vault via l'API admin.
func listSecrets(t *testing.T, env *testEnv, vault string) []struct {
	ID string `json:"id"`
} {
	t.Helper()
	res := env.do("GET", "/admin/secrets?vault="+vault, nil, "")
	defer res.Body.Close()
	var out []struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("list: %v", err)
	}
	return out
}

// ─── TOTP ───────────────────────────────────────────────────────────────────

func TestTOTPLoginFlow(t *testing.T) {
	// les fichiers TOTP dérivent du chemin du hash admin (global côté auth) :
	// pointer un temp dir AVANT le flux
	var svc auth.Service
	svc.SetHashPath(filepath.Join(t.TempDir(), "admin_hash"))
	env, _, _ := newTestEnv(t)

	// statut public : désactivé
	res, err := http.Get(env.srv.URL + "/totp/status")
	if err != nil {
		t.Fatal(err)
	}
	var st struct {
		Enabled bool `json:"enabled"`
	}
	_ = json.NewDecoder(res.Body).Decode(&st)
	res.Body.Close()
	if st.Enabled {
		t.Fatal("fresh instance: totp must be off")
	}

	// enrôlement : seed retourné une fois
	res = env.postJSON("/admin/2fa/enroll", nil)
	if res.StatusCode != 200 {
		t.Fatalf("enroll: %d", res.StatusCode)
	}
	var enroll struct {
		Seed string `json:"seed"`
		URI  string `json:"uri"`
	}
	_ = json.NewDecoder(res.Body).Decode(&enroll)
	res.Body.Close()
	if len(enroll.Seed) != 32 || enroll.URI == "" {
		t.Fatalf("bad enrollment payload: %+v", enroll)
	}

	// confirmation avec un code FAUX → refus, toujours pending
	if res := env.postJSON("/admin/2fa/confirm", map[string]string{"code": "000000"}); res.StatusCode != 401 {
		t.Fatalf("wrong code: %d, want 401", res.StatusCode)
	}

	// code juste → actif
	code, err := auth.TotpNow(enroll.Seed)
	if err != nil {
		t.Fatal(err)
	}
	if res := env.postJSON("/admin/2fa/confirm", map[string]string{"code": code}); res.StatusCode != 200 {
		t.Fatalf("confirm: %d, want 200", res.StatusCode)
	}

	// statut public : activé
	res, _ = http.Get(env.srv.URL + "/totp/status")
	_ = json.NewDecoder(res.Body).Decode(&st)
	res.Body.Close()
	if !st.Enabled {
		t.Fatal("after confirm, totp must be on")
	}

	// login SANS code → refus ; avec code FAUX → refus ; avec bon code → OK
	if _, c := login(t, env, "admin-pw", ""); c != 401 {
		t.Fatalf("no-code login: %d, want 401", c)
	}
	if _, c := login(t, env, "admin-pw", "000000"); c != 401 {
		t.Fatalf("bad-code login: %d, want 401", c)
	}
	code, _ = auth.TotpNow(enroll.Seed)
	cookie, c := login(t, env, "admin-pw", code)
	if c != 200 || cookie == "" {
		t.Fatalf("good-code login: %d cookie=%q", c, cookie)
	}

	// la session obtenue fonctionne réellement
	req, _ := http.NewRequest("GET", env.srv.URL+"/admin/agents", nil)
	req.AddCookie(&http.Cookie{Name: "av_session", Value: cookie})
	r2, err := http.DefaultClient.Do(req)
	if err != nil || r2.StatusCode != 200 {
		t.Fatalf("session must work: %v %d", err, statusOf(r2))
	}
	r2.Body.Close()
}

// login : POST /admin/login {password, totp} → (cookie, status).
func login(t *testing.T, env *testEnv, password, totp string) (string, int) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"password": password, "totp": totp})
	req, _ := http.NewRequest("POST", env.srv.URL+"/admin/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	for _, c := range res.Cookies() {
		if c.Name == "av_session" {
			return c.Value, res.StatusCode
		}
	}
	return "", res.StatusCode
}

func statusOf(r *http.Response) int {
	if r == nil {
		return 0
	}
	return r.StatusCode
}

// ─── export / restore ───────────────────────────────────────────────────────

func TestExportRestoreRoundTrip(t *testing.T) {
	env, _, _ := newTestEnv(t)
	env.postJSON("/admin/secrets", map[string]any{"vault": "rita-vault", "key": "DR_KEY", "value": "dr-value-xyz"})

	// export scellé par passphrase
	res := env.postJSON("/admin/export", map[string]string{"passphrase": "round-trip-pass!!"})
	if res.StatusCode != 200 {
		t.Fatalf("export: %d", res.StatusCode)
	}
	blob, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !bytes.HasPrefix(blob, []byte("KVX1")) {
		t.Fatal("not a KVX1 bundle")
	}

	// L'ACCIDENT : secret + vault supprimés
	// (la route webui de suppression vient de l'extender — nil dans l'env de
	// test ; on simule l'accident par le store, le résultat est identique)
	list := listSecrets(t, env, "rita-vault")
	if len(list) != 1 {
		t.Fatalf("want 1 secret, got %d", len(list))
	}
	if err := env.store.DeleteSecret(list[0].ID); err != nil {
		t.Fatalf("delete secret: %v", err)
	}
	vaultID := ""
	vaults := map[string]string{}
	vres := env.do("GET", "/admin/vaults", nil, "")
	var vlist []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	_ = json.NewDecoder(vres.Body).Decode(&vlist)
	vres.Body.Close()
	for _, v := range vlist {
		vaults[v.Name] = v.ID
		if v.Name == "rita-vault" {
			vaultID = v.ID
		}
	}
	if res := env.do("DELETE", "/admin/vaults/"+vaultID, nil, ""); res.StatusCode != 200 {
		t.Fatalf("delete vault: %d", res.StatusCode)
	}

	// dry-run : rita-vault sera importé, other-vault (déjà présent) sera ignoré
	dr := postRestore(t, env, blob, "round-trip-pass!!", true)
	if dr.StatusCode != 200 {
		t.Fatalf("dry-run: %d", dr.StatusCode)
	}
	var report struct {
		Vaults []struct {
			Name   string `json:"name"`
			Status string `json:"status"`
		} `json:"vaults"`
	}
	_ = json.NewDecoder(dr.Body).Decode(&report)
	dr.Body.Close()
	statuses := map[string]string{}
	for _, v := range report.Vaults {
		statuses[v.Name] = v.Status
	}
	if statuses["rita-vault"] != "imported" || statuses["other-vault"] != "skipped" {
		t.Fatalf("dry-run statuses: %+v", statuses)
	}

	// import réel : rita-vault revit avec son secret
	ir := postRestore(t, env, blob, "round-trip-pass!!", false)
	if ir.StatusCode != 200 {
		t.Fatalf("restore: %d", ir.StatusCode)
	}
	ir.Body.Close()

	// la preuve : la valeur est intacte
	list = listSecrets(t, env, "rita-vault")
	if len(list) != 1 {
		t.Fatalf("after restore: want 1 secret, got %d", len(list))
	}
	res = env.do("GET", "/admin/secrets?vault=rita-vault", nil, "")
	var withValue []struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	_ = json.NewDecoder(res.Body).Decode(&withValue)
	res.Body.Close()
	if withValue[0].Key != "DR_KEY" || withValue[0].Value != "dr-value-xyz" {
		t.Fatalf("restored secret wrong: %+v", withValue)
	}

	// mauvaise passphrase : refus uniforme
	if res := postRestore(t, env, blob, "wrong-passphrase!!", true); res.StatusCode != 400 {
		t.Fatalf("wrong passphrase: %d, want 400", res.StatusCode)
	}
}

// postRestore : multipart bundle+pass, cookie admin, ?dry_run optionnel.
func postRestore(t *testing.T, env *testEnv, blob []byte, pass string, dryRun bool) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("bundle", "backup.kvx")
	_, _ = fw.Write(blob)
	_ = mw.WriteField("pass", pass)
	_ = mw.Close()

	path := env.srv.URL + "/admin/restore"
	if dryRun {
		path += "?dry_run=1"
	}
	req, _ := http.NewRequest("POST", path, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: "av_session", Value: env.adminKey})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}