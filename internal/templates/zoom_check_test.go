// v1.9.1 — le template Zoom (Server-to-Server OAuth) doit exposer
// exactement les 3 clés du panneau « App credentials » d'une S2S app,
// toutes requises, avec le secret bien marqué TypePassword.
// SPDX-License-Identifier: AGPL-3.0

package templates

import "testing"

func TestZoomS2SOAuthTemplate(t *testing.T) {
	tpl, ok := Get("zoom")
	if !ok {
		t.Fatal("zoom template missing")
	}
	want := []struct{ name string; secret bool }{
		{"account_id", false},
		{"client_id", false},
		{"client_secret", true},
	}
	if len(tpl.Fields) != len(want) {
		t.Fatalf("zoom: %d fields, want %d (account_id, client_id, client_secret)", len(tpl.Fields), len(want))
	}
	for i, w := range want {
		f := tpl.Fields[i]
		if f.Name != w.name || !f.Required {
			t.Errorf("zoom field %d: %q required=%v, want %q required", i, f.Name, f.Required, w.name)
		}
		if w.secret && f.Type != TypePassword {
			t.Errorf("zoom %q must be TypePassword, got %s", f.Name, f.Type)
		}
	}
	if got := tpl.Validate(map[string]any{"account_id": "123", "client_id": "c", "client_secret": "s"}); len(got) != 0 {
		t.Fatalf("valid zoom values rejected: %v", got)
	}
	if got := tpl.Validate(map[string]any{}); len(got) != 3 {
		t.Fatalf("zoom: empty values → %d errors, want 3 (all required)", len(got))
	}
}
