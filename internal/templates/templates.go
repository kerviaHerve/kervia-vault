// Package templates defines credential templates for well-known services.
// A template describes the STRUCTURE of a secret (fields, types, required),
// so agents and humans create well-formed credentials instead of blobs.
//
// Design:
//   - Templates are pure Go data (no DB needed) — versioned with the code.
//   - A secret's value is stored as JSON matching the template fields.
//   - template=null on a secret means "free-form value" (backward compatible).
//
// SPDX-License-Identifier: AGPL-3.0

package templates

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// FieldType is the input type of a template field.
type FieldType string

const (
	TypeText     FieldType = "text"     // visible value
	TypePassword FieldType = "password" // masked in webui
	TypeURL      FieldType = "url"      // must parse as http(s) URL
	TypeNumber   FieldType = "number"   // integer
	TypeEmail    FieldType = "email"    // must contain @
	TypeTextArea FieldType = "textarea" // multi-line (certificates, JSON keys)
)

// Field describes one credential field.
type Field struct {
	Name        string    `json:"name"`
	Label       string    `json:"label"`
	Type        FieldType `json:"type"`
	Required    bool      `json:"required"`
	Placeholder string    `json:"placeholder,omitempty"`
	Help        string    `json:"help,omitempty"`
	Min         int       `json:"min,omitempty"` // for number: range
	Max         int       `json:"max,omitempty"`
}

// Template is a credential structure for a service family.
type Template struct {
	Key         string  `json:"key"`
	Name        string  `json:"name"`
	Category    string  `json:"category"`
	Description string  `json:"description"`
	Fields      []Field `json:"fields"`
}

// All returns every template, categorized.
func All() []Template {
	out := make([]Template, 0, len(allTemplates))
	for _, t := range orderedKeys {
		out = append(out, allTemplates[t])
	}
	return out
}

// Get returns one template by key.
func Get(key string) (Template, bool) {
	t, ok := allTemplates[key]
	return t, ok
}

// Validate checks a values map against the template:
//   - required fields present and non-empty
//   - types respected (url parses, number is int, email has @)
//   - unknown fields are REJECTED (fail-closed: no silent typos like
//     "passwrod" that would look fine but break at 3am)
//
// Returns a list of human-readable errors (empty = valid).
func (t Template) Validate(values map[string]any) []string {
	var errs []string
	fields := make(map[string]Field, len(t.Fields))
	for _, f := range t.Fields {
		fields[f.Name] = f
	}
	// unknown fields are rejected
	for k := range values {
		if _, ok := fields[k]; !ok {
			errs = append(errs, fmt.Sprintf("unknown field %q for template %q", k, t.Key))
		}
	}
	for _, f := range t.Fields {
		v, ok := values[f.Name]
		if !ok || v == nil {
			if f.Required {
				errs = append(errs, fmt.Sprintf("missing required field %q", f.Name))
			}
			continue
		}
		s, isStr := v.(string)
		if !isStr {
			// numbers may arrive as float64 from JSON
			if f.Type == TypeNumber {
				if _, ok := v.(float64); ok {
					continue
				}
			}
			errs = append(errs, fmt.Sprintf("field %q must be a string", f.Name))
			continue
		}
		if f.Required && strings.TrimSpace(s) == "" {
			errs = append(errs, fmt.Sprintf("field %q is required and empty", f.Name))
			continue
		}
		if strings.TrimSpace(s) == "" {
			continue // optional empty is fine
		}
		switch f.Type {
		case TypeURL:
			u, err := url.Parse(s)
			if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
				errs = append(errs, fmt.Sprintf("field %q must be a valid http(s) URL", f.Name))
			}
		case TypeNumber:
			n, err := strconv.Atoi(s)
			if err != nil {
				// float64 accepted via JSON numbers
				if _, isF := v.(float64); !isF {
					errs = append(errs, fmt.Sprintf("field %q must be a number", f.Name))
					break
				}
				continue
			}
			if f.Min != 0 && n < f.Min {
				errs = append(errs, fmt.Sprintf("field %q must be >= %d", f.Name, f.Min))
			}
			if f.Max != 0 && n > f.Max {
				errs = append(errs, fmt.Sprintf("field %q must be <= %d", f.Name, f.Max))
			}
		case TypeEmail:
			if !strings.Contains(s, "@") {
				errs = append(errs, fmt.Sprintf("field %q must be an email address", f.Name))
			}
		}
	}
	return errs
}