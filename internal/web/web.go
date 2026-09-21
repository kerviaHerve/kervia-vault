// Package web: embedded WebUI (HTMX + hand-rolled design system).
// Zero external dependencies, zero build step — go:embed only.
//
// SPDX-License-Identifier: AGPL-3.0

package web

import (
	"embed"
	"encoding/json"
	"io/fs"
	"html/template"
	"net/http"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/model"
	"github.com/kerviaHerve/kervia-vault/internal/store"
	"github.com/kerviaHerve/kervia-vault/internal/templates"
)

//go:embed static/* *.html
var files embed.FS

// Server renders the webui pages.
type Server struct {
	store   *store.Store
	authSvc *auth.Service
	enc     *crypto.Encryptor
	tpl     *template.Template
}

// New parses all templates once (fail-closed: broken template = no boot).
func New(st *store.Store, authSvc *auth.Service, enc *crypto.Encryptor) *Server {
	funcs := template.FuncMap{
		"secretRef": func(s string) string {
			if len(s) > 10 {
				return s[:10] + "…"
			}
			return s
		},
	}
	tpl, err := template.New("").Funcs(funcs).ParseFS(files, "*.html")
	if err != nil {
		panic("web: templates: " + err.Error())
	}
	return &Server{store: st, authSvc: authSvc, enc: enc, tpl: tpl}
}

// Routes mounts the webui under /ui/*.
func (s *Server) Routes(adminMux *http.ServeMux) {
	adminMux.HandleFunc("GET /ui/{$}", s.page(s.dashboard))
	adminMux.HandleFunc("GET /ui/agents", s.page(s.agents))
	adminMux.HandleFunc("GET /ui/vaults", s.page(s.vaults))
	adminMux.HandleFunc("GET /ui/secrets", s.page(s.secrets))
	adminMux.HandleFunc("GET /ui/grants", s.page(s.grants))
	adminMux.HandleFunc("GET /ui/audit", s.page(s.audit))
}

// page wraps a renderer with the common layout.
func (s *Server) page(render func(w http.ResponseWriter, r *http.Request) (string, any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name, data, err := render(w, r)
		if err != nil {
			http.Error(w, "internal error", 500)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := s.tpl.ExecuteTemplate(w, "layout.html", templateData{
			Active: name, Data: data,
		}); err != nil {
			// headers already sent — best effort
			_, _ = w.Write([]byte("<script>toast('Render error','error')</script>"))
		}
	}
}

// templateData is the payload of the layout.
type templateData struct {
	Active string // nav id
	Data   any
}

var _ = model.AuditRead // keep model imported for future use
var _ = templates.All
// templateOptions returns (key, label) for the create-secret dropdown.
func templateOptions() []struct{ key, label string } {
	var out []struct{ key, label string }
	for _, t := range templates.All() {
		out = append(out, struct{ key, label string }{t.Key, t.Name + " (" + t.Category + ")"})
	}
	return out
}

// templateJSON exports templates as JSON for the client-side form builder.
func templateJSON() string {
	b, err := json.Marshal(templates.All())
	if err != nil {
		return "{}"
	}
	return string(b)
}

// Files exposes the embedded static assets.
func Files() fs.FS {
	sub, err := fs.Sub(files, "static")
	if err != nil {
		panic("web: static: " + err.Error())
	}
	return sub
}

// AttachAdmin adds webui-specific admin endpoints (reveal, delete)
// to the guarded admin mux. These use the session auth like the rest of /admin.
func (s *Server) AttachAdmin(adminMux *http.ServeMux) {
	adminMux.HandleFunc("GET /admin/secrets/reveal", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		if id == "" {
			http.Error(w, `{"error":"missing id"}`, 400)
			return
		}
		sec, nonce, ct, err := s.store.GetSecretByID(id)
		if err != nil {
			http.Error(w, `{"error":"not_found"}`, 404)
			return
		}
		value, err := s.enc.Decrypt(nonce, ct)
		if err != nil {
			http.Error(w, `{"error":"internal"}`, 500)
			return
		}
		// templated secrets: pretty object, one field per line
		display := string(value)
		if sec.Template != "" {
			var obj map[string]any
			if json.Unmarshal(value, &obj) == nil {
				if pretty, err := json.MarshalIndent(obj, "", "  "); err == nil {
					display = string(pretty)
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"value":` + string(mustJSONBytes([]byte(display))) + `}`))
	})
	adminMux.HandleFunc("POST /admin/secrets/{id}/delete", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := s.store.DeleteSecret(id); err != nil {
			http.Error(w, `{"error":"not_found"}`, 404)
			return
		}
		_ = s.store.AppendAudit("admin", model.AuditDelete, "secret/"+id, "")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"status":"deleted"}`))
	})
}

func mustJSONBytes(b []byte) []byte {
	out, _ := json.Marshal(string(b))
	return out
}
