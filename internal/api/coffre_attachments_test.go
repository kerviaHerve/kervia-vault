// v1.9.0 — coffre attachments integration tests. Invariants under test:
//   - lifecycle: add → list (meta only, never the data) → get (both blobs)
//     → delete (idempotent) → get after delete = 404
//   - quotas are enforced SERVER-side (browser pre-checks are convenience):
//     2 MiB of decoded data per file, 5 attachments per item
//   - session guard: the admin surface only (agents were proven locked out
//     out of the whole coffre in coffre_test.go — same middleware)
//   - attachment on a nonexistent item = 404, never 500
//
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"
)

func b64s(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func TestCoffreAttachmentsLifecycle(t *testing.T) {
	env, ritaKey, _ := newTestEnv(t)
	_ = ritaKey

	res := env.postJSON("/admin/coffre", validEnvelope())
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("create coffre: %d", res.StatusCode)
	}

	res = env.postJSON("/admin/coffre/items", map[string]string{"blob_b64": b64s([]byte("item-blob"))})
	item := decode(t, res)
	itemID, _ := item["id"].(string)
	if itemID == "" {
		t.Fatalf("no item id: %v", item)
	}

	// ---- add ----
	meta := b64s(bytes.Repeat([]byte{0x0A}, 48))  // petit blob meta scellé (opaque)
	data := b64s(bytes.Repeat([]byte{0x5A}, 1024)) // contenu scellé (opaque)
	res = env.postJSON("/admin/coffre/items/"+itemID+"/attachments",
		map[string]string{"meta_b64": meta, "data_b64": data})
	if res.StatusCode != 201 {
		t.Fatalf("add attachment: %d", res.StatusCode)
	}
	att := decode(t, res)
	attID, _ := att["id"].(string)
	if attID == "" {
		t.Fatalf("no attachment id: %v", att)
	}

	// ---- list : meta + size, JAMAIS le data ----
	res = env.do("GET", "/admin/coffre/items/"+itemID+"/attachments", nil, "")
	list := decodeList(t, res)
	if len(list) != 1 {
		t.Fatalf("list: %d rows, want 1", len(list))
	}
	if list[0]["meta_b64"] != meta || list[0]["data_b64"] != nil {
		t.Fatal("list must carry meta_b64 and NEVER the data blob")
	}
	if list[0]["size"] != float64(1024) {
		t.Fatalf("size: %v, want 1024", list[0]["size"])
	}

	// ---- get : les deux blobs ----
	res = env.do("GET", "/admin/coffre/attachments/"+attID, nil, "")
	full := decode(t, res)
	if full["meta_b64"] != meta || full["data_b64"] != data {
		t.Fatal("get must round-trip both sealed blobs untouched")
	}

	// ---- quotas serveur ----
	// 4 de plus → 5 total (max)
	for i := 0; i < 4; i++ {
		res = env.postJSON("/admin/coffre/items/"+itemID+"/attachments",
			map[string]string{"meta_b64": meta, "data_b64": data})
		res.Body.Close()
		if res.StatusCode != 201 {
			t.Fatalf("add %d: %d", i, res.StatusCode)
		}
	}
	// 6e → attach_too_many
	res = env.postJSON("/admin/coffre/items/"+itemID+"/attachments",
		map[string]string{"meta_b64": meta, "data_b64": data})
	if res.StatusCode != 400 || decode(t, res)["error"] != "attach_too_many" {
		t.Fatal("6th attachment must be attach_too_many")
	}
	// trop gros → attach_too_big (2 MiB décodés + 1 octet)
	res = env.postJSON("/admin/coffre/items/"+itemID+"/attachments",
		map[string]string{"meta_b64": meta, "data_b64": b64s(bytes.Repeat([]byte{1}, 2<<20+1))})
	if res.StatusCode != 400 || decode(t, res)["error"] != "attach_too_big" {
		t.Fatal("oversized attachment must be attach_too_big")
	}

	// ---- item parent inexistant → 404, pas 500 ----
	res = env.postJSON("/admin/coffre/items/does-not-exist/attachments",
		map[string]string{"meta_b64": meta, "data_b64": data})
	if res.StatusCode != 404 {
		t.Fatalf("attachment on missing item: %d, want 404", res.StatusCode)
	}

	// ---- delete : idempotent, puis 404 ----
	res = env.do("DELETE", "/admin/coffre/attachments/"+attID, nil, "")
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("delete attachment: %d", res.StatusCode)
	}
	res = env.do("DELETE", "/admin/coffre/attachments/"+attID, nil, "")
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal("re-delete must stay 200 (idempotent)")
	}
	res = env.do("GET", "/admin/coffre/attachments/"+attID, nil, "")
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatalf("get after delete: %d, want 404", res.StatusCode)
	}

	// ---- audit : les entrées ne portent QUE des ids opaques ----
	res = env.do("GET", "/admin/audit?limit=100", nil, "")
	var entries []map[string]any
	defer res.Body.Close()
	_ = json.NewDecoder(res.Body).Decode(&entries)
	for _, e := range entries {
		if a, _ := e["action"].(string); a == "coffre_attach_add" || a == "coffre_attach_delete" {
			if r, _ := e["resource"].(string); !bytes.Contains([]byte(r), []byte("coffre/attachment/")) {
				t.Fatalf("audit resource for attachment: %q", r)
			}
		}
	}
}

func decodeList(t *testing.T, res *http.Response) []map[string]any {
	t.Helper()
	defer res.Body.Close()
	var out []map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return out
}
