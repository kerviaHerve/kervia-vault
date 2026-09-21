// Templates tests — validation engine invariants.
// SPDX-License-Identifier: AGPL-3.0

package templates

import (
	"strings"
	"testing"
)

func TestAllTemplatesHaveRequiredStructure(t *testing.T) {
	all := All()
	if len(all) < 40 {
		t.Fatalf("expected 40+ templates, got %d", len(all))
	}
	seen := map[string]bool{}
	for _, tpl := range all {
		if tpl.Key == "" || tpl.Name == "" || tpl.Category == "" {
			t.Errorf("template %q missing key/name/category", tpl.Key)
		}
		if len(tpl.Fields) == 0 {
			t.Errorf("template %q has no fields", tpl.Key)
		}
		if seen[tpl.Key] {
			t.Errorf("duplicate key %q", tpl.Key)
		}
		seen[tpl.Key] = true
		for _, f := range tpl.Fields {
			if f.Name == "" || f.Label == "" {
				t.Errorf("template %q: field without name/label", tpl.Key)
			}
			switch f.Type {
			case TypeText, TypePassword, TypeURL, TypeNumber, TypeEmail, TypeTextArea:
			default:
				t.Errorf("template %q field %q: unknown type %q", tpl.Key, f.Name, f.Type)
			}
		}
	}
}

func TestPostgresValidation(t *testing.T) {
	tpl, ok := Get("postgres")
	if !ok {
		t.Fatal("postgres template missing")
	}
	// valid
	errs := tpl.Validate(map[string]any{
		"host": "db.example.com", "database": "app", "username": "u", "password": "p",
	})
	if len(errs) != 0 {
		t.Fatalf("valid values rejected: %v", errs)
	}
	// missing required
	errs = tpl.Validate(map[string]any{"host": "x"})
	if len(errs) != 3 { // database, username, password
		t.Fatalf("expected 3 errors, got %v", errs)
	}
	// unknown field (typo protection)
	errs = tpl.Validate(map[string]any{
		"host": "x", "database": "d", "username": "u", "password": "p", "passwrod": "typo",
	})
	if len(errs) != 1 || !strings.Contains(errs[0], "unknown field") {
		t.Fatalf("typo field not rejected: %v", errs)
	}
	// bad port
	errs = tpl.Validate(map[string]any{
		"host": "x", "port": "99999", "database": "d", "username": "u", "password": "p",
	})
	if len(errs) != 1 || !strings.Contains(errs[0], "<=") {
		t.Fatalf("bad port not rejected: %v", errs)
	}
}

func TestURLAndEmailValidation(t *testing.T) {
	tpl, _ := Get("bearer")
	errs := tpl.Validate(map[string]any{"token": "t", "base_url": "notaurl"})
	if len(errs) != 1 {
		t.Fatalf("bad URL accepted: %v", errs)
	}
	errs = tpl.Validate(map[string]any{"token": "t", "base_url": "https://api.example.com"})
	if len(errs) != 0 {
		t.Fatalf("valid URL rejected: %v", errs)
	}
	tpl2, _ := Get("gmail")
	errs = tpl2.Validate(map[string]any{"username": "not-an-email"})
	if len(errs) != 1 {
		t.Fatalf("bad email accepted: %v", errs)
	}
}

func TestOptionalEmptyAccepted(t *testing.T) {
	tpl, _ := Get("openai")
	errs := tpl.Validate(map[string]any{"api_key": "sk-x", "org_id": ""})
	if len(errs) != 0 {
		t.Fatalf("empty optional rejected: %v", errs)
	}
}

func TestGetUnknown(t *testing.T) {
	if _, ok := Get("does-not-exist"); ok {
		t.Fatal("unknown template found")
	}
}