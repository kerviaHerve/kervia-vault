// v1.9.3 — secret notes: create with note, read (agent + webui shapes),
// update-value preserves note, note-only update, clear, share never leaks
// the note, export/restore round-trips it.
//
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func decodeBody(t *testing.T, res *http.Response) map[string]any {
	t.Helper()
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return out
}

func TestSecretNoteLifecycle(t *testing.T) {
	env, ritaKey, _ := newTestEnv(t)

	// ---- création AVEC note (agent) ----
	res := env.do("POST", "/v1/secrets", map[string]any{
		"vault": "rita-vault", "key": "NOTED", "value": "the-value",
		"note": "rotation le 15, contact ops@kervia.ch",
	}, ritaKey)
	if res.StatusCode != 201 {
		t.Fatalf("create with note: %d", res.StatusCode)
	}
	created := decodeBody(t, res)
	id, _ := created["id"].(string)

	// ---- lecture agent : la note est là ----
	res = env.do("GET", "/v1/secrets/"+id, nil, ritaKey)
	got := decodeBody(t, res)
	if got["note"] != "rotation le 15, contact ops@kervia.ch" {
		t.Fatalf("agent get: note = %v", got["note"])
	}
	if got["value"] != "the-value" {
		t.Fatalf("agent get: value = %v", got["value"])
	}

	// ---- MAJ de la VALEUR sans toucher la note → note PRÉSERVÉE ----
	res = env.do("PATCH", "/v1/secrets/"+id, map[string]any{"value": "the-value-v2"}, ritaKey)
	if res.StatusCode != 200 {
		res.Body.Close()
		t.Fatalf("update value: %d", res.StatusCode)
	}
	res = env.do("GET", "/v1/secrets/"+id, nil, ritaKey)
	got = decodeBody(t, res)
	if got["note"] != "rotation le 15, contact ops@kervia.ch" {
		t.Fatalf("update value must PRESERVE the note, got %q", got["note"])
	}
	if got["value"] != "the-value-v2" {
		t.Fatalf("value after update: %v", got["value"])
	}

	// ---- MAJ note seule (webui admin, PATCH) ----
	res = env.do("PATCH", "/admin/secrets/"+id, map[string]any{"note": "nouvelle note"}, "")
	if res.StatusCode != 200 {
		res.Body.Close()
		t.Fatalf("admin note-only update: %d", res.StatusCode)
	}
	res = env.do("GET", "/v1/secrets/"+id, nil, ritaKey)
	got = decodeBody(t, res)
	if got["note"] != "nouvelle note" {
		t.Fatalf("admin note-only update: note = %v", got["note"])
	}

	// ---- effacement explicite ("" = clear, via le champ ptr) ----
	res = env.do("PATCH", "/v1/secrets/"+id, map[string]any{"value": "the-value-v3", "note": ""}, ritaKey)
	if res.StatusCode != 200 {
		res.Body.Close()
		t.Fatalf("clear note: %d", res.StatusCode)
	}
	res = env.do("GET", "/v1/secrets/"+id, nil, ritaKey)
	got = decodeBody(t, res)
	if got["note"] != nil && got["note"] != "" {
		t.Fatalf("note must be cleared, got %q", got["note"])
	}

	// ---- liste webui (avec valeurs) : la note est servie ----
	res = env.do("POST", "/v1/secrets", map[string]any{
		"vault": "rita-vault", "key": "NOTED2", "value": "v", "note": "note webui",
	}, ritaKey)
	res.Body.Close()
	res = env.do("GET", "/admin/secrets?vault=rita-vault", nil, "")
	var list []map[string]any
	defer res.Body.Close()
	_ = json.NewDecoder(res.Body).Decode(&list)
	found := false
	for _, s := range list {
		if s["key"] == "NOTED2" {
			found = true
			if s["note"] != "note webui" {
				t.Fatalf("webui list note: %v", s["note"])
			}
		}
		if s["key"] == "NOTED" && s["note"] != "" {
			t.Fatalf("webui list: cleared note must stay empty, got %v", s["note"])
		}
	}
	if !found {
		t.Fatal("NOTED2 missing from webui list")
	}

	// ---- lien de partage : la note ne fuit JAMAIS (la page dévoile la valeur seule) ----
	res = env.do("POST", "/admin/secrets/"+id+"/share", map[string]any{"ttl_minutes": 60}, "")
	var share struct{ URL string }
	_ = json.NewDecoder(res.Body).Decode(&share)
	res.Body.Close()
	page, _ := http.Get(env.srv.URL + share.URL)

	body, _ := io.ReadAll(page.Body)
	page.Body.Close()
	if bytes.Contains(body, []byte("nouvelle note")) || bytes.Contains(body, []byte("note")) {
		t.Fatal("the one-time share page must NEVER disclose the note")
	}
	if !bytes.Contains(body, []byte("the-value-v3")) {
		t.Fatal("share page must still disclose the value")
	}

	// ---- garde-fou longueur ----
	res = env.do("POST", "/v1/secrets", map[string]any{
		"vault": "rita-vault", "key": "TOOBIG", "value": "v", "note": string(bytes.Repeat([]byte{'n'}, 5000)),
	}, ritaKey)
	if res.StatusCode != 400 {
		res.Body.Close()
		t.Fatalf("oversized note: %d, want 400", res.StatusCode)
	}
	res.Body.Close()
}
