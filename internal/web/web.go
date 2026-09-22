// Package web serves the embedded webui SPA (React build, go:embed)
// and the session-guarded UI endpoints.
//
// SPDX-License-Identifier: AGPL-3.0
package web

import (
	"embed"
	"encoding/json"
	"io/fs"
	"net/http"

	"github.com/kerviaHerve/kervia-vault/internal/auth"
	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/model"
	"github.com/kerviaHerve/kervia-vault/internal/store"
	"github.com/kerviaHerve/kervia-vault/internal/templates"
)

//go:embed all:dist
var files embed.FS

// Server renders the webui pages.
type Server struct {
	store   *store.Store
	authSvc *auth.Service
	enc     *crypto.Encryptor
}

// New parses all templates once (fail-closed: broken template = no boot).
func New(st *store.Store, authSvc *auth.Service, enc *crypto.Encryptor) *Server {
	return &Server{store: st, authSvc: authSvc, enc: enc}
}

// spaFS is the embedded dist tree (built by web-app/).
var spaFS fs.FS

// Routes mounts the SPA webui under /ui/* (built by web-app/ → dist/).
func (s *Server) Routes(adminMux *http.ServeMux) {
	sub, err := fs.Sub(files, "dist")
	if err != nil {
		panic("web: dist: " + err.Error())
	}
	spaFS = sub
	fileServer := http.FileServer(http.FS(sub))
	// assets with hashed names: immutable cache
	adminMux.Handle("GET /ui/assets/", cacheImmutable(http.StripPrefix("/ui/", fileServer)))
	// SPA fallback: every /ui/* path serves index.html (client-side hash routing)
	adminMux.HandleFunc("GET /ui/", func(w http.ResponseWriter, _ *http.Request) {
		b, err := fs.ReadFile(spaFS, "index.html")
		if err != nil {
			http.Error(w, "webui missing", 500)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(b)
	})
}

// cacheImmutable sets long cache for hashed assets.
func cacheImmutable(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		next.ServeHTTP(w, r)
	})
}

var _ = model.AuditRead // keep model imported for future use
var _ = templates.All

// Files exposes the embedded static assets.
func Files() fs.FS {
	sub, err := fs.Sub(files, "static")
	if err != nil {
		panic("web: static: " + err.Error())
	}
	return sub
}

// AttachAdmin adds webui-specific admin endpoints (reveal, delete, templates)
// to the guarded admin mux. These use the session auth like the rest of /admin.
func (s *Server) AttachAdmin(adminMux *http.ServeMux) {
	// settings info for the SPA settings page
	adminMux.HandleFunc("GET /admin/settings", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"audit_retention_days": 90, "min_password_length": 12}`))
	})
	// search across ALL vaults (metadata only)
	adminMux.HandleFunc("GET /admin/secrets/search", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		if q == "" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte("[]"))
			return
		}
		results, err := s.store.SearchSecretsByName(q, 100)
		if err != nil {
			http.Error(w, `{"error":"internal"}`, 500)
			return
		}
		if results == nil {
			results = []*model.Secret{}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(results)
	})
	// templates readable by the admin session (the SPA creates templated secrets)
	adminMux.HandleFunc("GET /admin/templates", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(templates.All())
	})
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
		// templated secrets: the webui shows a labeled field card, not raw JSON.
		// fields[] carries the template's human labels + field types so the
		// client can render/mask properly. value stays for copy/export.
		resp := map[string]any{"value": string(value)}
		if sec.Template != "" {
			var obj map[string]any
			if json.Unmarshal(value, &obj) == nil {
				if tpl, ok := templates.ByKey(sec.Template); ok {
					type field struct {
						Label string `json:"label"`
						Type  string `json:"type"`
						Value string `json:"value"`
					}
					fields := make([]field, 0, len(tpl.Fields))
					for _, f := range tpl.Fields {
						v, present := obj[f.Name]
						if !present {
							continue
						}
						sv, _ := v.(string)
						fields = append(fields, field{Label: f.Label, Type: string(f.Type), Value: sv})
					}
					// unknown keys (not in the template) — surfaced as-is
					for k, v := range obj {
						known := false
						for _, f := range tpl.Fields {
							if f.Name == k {
								known = true
								break
							}
						}
						if !known {
							sv, _ := v.(string)
							fields = append(fields, field{Label: k, Type: string(templates.TypeText), Value: sv})
						}
					}
					if pretty, err := json.MarshalIndent(obj, "", "  "); err == nil {
						resp["value"] = string(pretty)
					}
					resp["template"] = sec.Template
					resp["fields"] = fields
				}
			}
		}
		respB, _ := json.Marshal(resp)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(respB)
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

