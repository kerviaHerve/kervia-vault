// Webui page renderers. Each returns (nav-id, content, error).
// JS lives in static/app.js — no inline <script> blobs.
//
// SPDX-License-Identifier: AGPL-3.0

package web

import (
	"fmt"
	"html/template"
	"net/http"
	"strings"

	"github.com/kerviaHerve/kervia-vault/internal/model"
)

func raw(s string) template.HTML { return template.HTML(s) }

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) (string, any, error) {
	agents, _ := s.store.ListAgents()
	vaults, _ := s.store.ListVaults()
	audit, _ := s.store.ListAudit(8, 0, "")
	active := 0
	for _, a := range agents {
		if a.RevokedAt == nil {
			active++
		}
	}
	secretCount := 0
	for _, v := range vaults {
		secs, err := s.store.ListSecretsByVault(v.ID)
		if err == nil {
			secretCount += len(secs)
		}
	}
	var b strings.Builder
	fmt.Fprintf(&b, `
<div class="page-head">
  <div><div class="page-title">Vue d'ensemble</div>
  <div class="page-sub">Votre coffre multi-agents, en temps réel.</div></div>
</div>
<div class="stats">
  <div class="stat"><div class="num">%d</div><div class="label">Agents actifs</div></div>
  <div class="stat"><div class="num">%d</div><div class="label">Vaults</div></div>
  <div class="stat"><div class="num">%d</div><div class="label">Secrets</div></div>
</div>
<div class="card">
  <div class="card-head"><div class="card-title">Dernière activité</div></div>
  <table>
    <thead><tr><th>Quand</th><th>Qui</th><th>Action</th><th>Ressource</th></tr></thead>
    <tbody>`, active, len(vaults), secretCount)
	for _, e := range audit {
		fmt.Fprintf(&b, `<tr><td class="t2">%s</td><td>%s</td><td><span class="badge neutral">%s</span></td><td class="mono t2">%s</td></tr>`,
			e.TS.Format("02 Jan 15:04"), e.AgentID, e.Action, e.Resource)
	}
	b.WriteString(`</tbody></table></div>`)
	return "dashboard", raw(b.String()), nil
}

func (s *Server) agents(w http.ResponseWriter, r *http.Request) (string, any, error) {
	agents, _ := s.store.ListAgents()
	var b strings.Builder
	b.WriteString(`
<div class="page-head">
  <div><div class="page-title">Agents</div>
  <div class="page-sub">Une clé API par agent — révocable à tout moment.</div></div>
  <button class="btn primary" onclick="ui.newAgent()">＋ Nouvel agent</button>
</div>
<div class="card">
<table>
  <thead><tr><th>Nom</th><th>Clé</th><th>Statut</th><th>Dernier accès</th><th>Créé</th><th></th></tr></thead>
  <tbody>`)
	for _, a := range agents {
		status := `<span class="badge ok"><span class="dot"></span> actif</span>`
		if a.RevokedAt != nil {
			status = `<span class="badge off"><span class="dot"></span> révoqué</span>`
		}
		last := "—"
		if a.LastUsed != nil {
			last = a.LastUsed.Format("02 Jan 15:04")
		}
		fmt.Fprintf(&b, `<tr>
<td><strong>%s</strong></td>
<td class="mono t2">%s…</td>
<td>%s</td>
<td class="t2">%s</td>
<td class="t2">%s</td>
<td>`, a.Name, a.KeyPrefix, status, last, a.CreatedAt.Format("02 Jan 2006"))
		if a.RevokedAt == nil {
			fmt.Fprintf(&b, `<button class="btn small danger" onclick="ui.revokeAgent('%s','%s')">Révoquer</button>`, a.ID, a.Name)
		}
		b.WriteString(`</td></tr>`)
	}
	if len(agents) == 0 {
		b.WriteString(`<tr><td colspan="6"><div class="empty"><div class="big">◆</div>Aucun agent. Créez le premier pour donner accès à un coffre.</div></td></tr>`)
	}
	b.WriteString(`</tbody></table></div>`)
	return "agents", raw(b.String()), nil
}

func (s *Server) vaults(w http.ResponseWriter, r *http.Request) (string, any, error) {
	vaults, _ := s.store.ListVaults()
	grants, _ := s.store.ListGrants()
	var b strings.Builder
	b.WriteString(`
<div class="page-head">
  <div><div class="page-title">Vaults</div>
  <div class="page-sub">Un vault par agent ou par usage — les permissions se gèrent dans l'onglet Permissions.</div></div>
  <button class="btn primary" onclick="ui.newVault()">＋ Nouveau vault</button>
</div>
<div class="card">
<table>
  <thead><tr><th>Nom</th><th>Secrets</th><th>Agents autorisés</th><th>Créé</th></tr></thead>
  <tbody>`)
	for _, v := range vaults {
		secrets, _ := s.store.ListSecretsByVault(v.ID)
		count := 0
		for _, g := range grants {
			if g.VaultID == v.ID {
				count++
			}
		}
		fmt.Fprintf(&b, `<tr><td><strong>%s</strong></td><td>%d</td><td>%d</td><td class="t2">%s</td></tr>`,
			v.Name, len(secrets), count, v.CreatedAt.Format("02 Jan 2006"))
	}
	if len(vaults) == 0 {
		b.WriteString(`<tr><td colspan="4"><div class="empty"><div class="big">▤</div>Aucun vault. Ex : « rita », « ci », « commun ».</div></td></tr>`)
	}
	b.WriteString(`</tbody></table></div>`)
	return "vaults", raw(b.String()), nil
}

func (s *Server) secrets(w http.ResponseWriter, r *http.Request) (string, any, error) {
	vaults, _ := s.store.ListVaults()
	selected := r.URL.Query().Get("vault")
	if selected == "" && len(vaults) > 0 {
		selected = vaults[0].Name
	}
	var b strings.Builder
	b.WriteString(`
<div class="page-head">
  <div><div class="page-title">Secrets</div>
  <div class="page-sub">Les valeurs ne s'affichent que sur clic — jamais par défaut.</div></div>
  <div class="flex">`)
	for _, v := range vaults {
		cls := "btn"
		if v.Name == selected {
			cls = "btn primary"
		}
		fmt.Fprintf(&b, `<a href="/ui/secrets?vault=%s" class="%s">%s</a>`, v.Name, cls, v.Name)
	}
	b.WriteString(`</div>
<button class="btn primary" onclick="ui.newSecret()">＋ Nouveau secret</button>
</div>`)

	for _, v := range vaults {
		if v.Name != selected {
			continue
		}
		secrets, _ := s.store.ListSecretsByVault(v.ID)
		b.WriteString(`<div class="card"><table>
<thead><tr><th>Clé</th><th>Type</th><th>Valeur</th><th>Version</th><th>MàJ</th><th></th></tr></thead>
<tbody>`)
		for _, sec := range secrets {
			tpl := `<span class="badge neutral">libre</span>`
			if sec.Template != "" {
				tpl = fmt.Sprintf(`<span class="badge accent">%s</span>`, sec.Template)
			}
			fmt.Fprintf(&b, `<tr>
<td><strong>%s</strong></td>
<td>%s</td>
<td><span class="secret-value" id="v-%s">••••••••••••</span>
    <button class="btn ghost small" onclick="ui.reveal('%s', this)">révéler</button></td>
<td class="t2">v%d</td>
<td class="t2">%s</td>
<td><button class="btn small danger" onclick="ui.delSecret('%s','%s')">✕</button></td>
</tr>`, sec.Key, tpl, sec.ID, sec.ID, sec.Version, sec.UpdatedAt.Format("02 Jan 15:04"), sec.ID, sec.Key)
		}
		if len(secrets) == 0 {
			b.WriteString(`<tr><td colspan="6"><div class="empty"><div class="big">✦</div>Vault vide. Créez un secret (avec template si possible).</div></td></tr>`)
		}
		b.WriteString(`</tbody></table></div>`)
	}
	// data for the create modal
	var opts strings.Builder
	for _, t := range templateOptions() {
		fmt.Fprintf(&opts, `<option value="%s">%s</option>`, t.key, t.label)
	}
	fmt.Fprintf(&b, `<div id="page-data" data-vault="%s" data-templates='%s' style="display:none"></div>`,
		selected, templateJSON())
	return "secrets", raw(b.String()), nil
}

func (s *Server) grants(w http.ResponseWriter, r *http.Request) (string, any, error) {
	agents, _ := s.store.ListAgents()
	vaults, _ := s.store.ListVaults()
	grants, _ := s.store.ListGrants()
	type g struct{ Write bool }
	m := map[string]*g{}
	for _, gr := range grants {
		k := gr.AgentID + "|" + gr.VaultID
		e, ok := m[k]
		if !ok {
			e = &g{}
			m[k] = e
		}
		e.Write = e.Write || gr.CanWrite
	}
	var b strings.Builder
	b.WriteString(`
<div class="page-head">
  <div><div class="page-title">Permissions</div>
  <div class="page-sub">Cliquez sur une case pour changer le niveau : rien → lecture → lecture+écriture.</div></div>
</div>
<div class="card"><table class="matrix">
<thead><tr><th>Agent ↓ / Vault →</th>`)
	for _, v := range vaults {
		fmt.Fprintf(&b, `<th>%s</th>`, v.Name)
	}
	b.WriteString(`</tr></thead><tbody>`)
	for _, a := range agents {
		if a.RevokedAt != nil {
			continue
		}
		fmt.Fprintf(&b, `<tr><td><strong>%s</strong></td>`, a.Name)
		for _, v := range vaults {
			e := m[a.ID+"|"+v.ID]
			cls, label, next := "none", "—", "ro"
			if e != nil && e.Write {
				cls, label, next = "rw", "RW", "none"
			} else if e != nil {
				cls, label, next = "ro", "RO", "rw"
			}
			fmt.Fprintf(&b, `<td><button class="cell-btn %s" onclick="ui.cycle('%s','%s','%s')">%s</button></td>`,
				cls, a.ID, v.ID, next, label)
		}
		b.WriteString(`</tr>`)
	}
	b.WriteString(`</tbody></table></div>`)
	return "grants", raw(b.String()), nil
}

func (s *Server) audit(w http.ResponseWriter, r *http.Request) (string, any, error) {
	entries, _ := s.store.ListAudit(100, 0, "")
	badges := map[string]string{
		model.AuditRead:        "neutral",
		model.AuditCreate:      "ok",
		model.AuditUpdate:      "accent",
		model.AuditDelete:     "off",
		model.AuditLoginFail:  "off",
		model.AuditRateLimited: "warn",
	}
	var b strings.Builder
	b.WriteString(`
<div class="page-head">
  <div><div class="page-title">Audit</div>
  <div class="page-sub">Chaque lecture, écriture et accès refusé — trace append-only.</div></div>
</div>
<div class="card">
<table>
  <thead><tr><th>Horodatage</th><th>Agent</th><th>Action</th><th>Ressource</th><th>Détail</th></tr></thead>
  <tbody>`)
	for _, e := range entries {
		cls := badges[e.Action]
		if cls == "" {
			cls = "neutral"
		}
		detail := `<span class="t2">—</span>`
		if e.Detail != "" {
			detail = fmt.Sprintf(`<span class="t2 small">%s</span>`, e.Detail)
		}
		fmt.Fprintf(&b, `<tr>
<td class="t2" style="white-space:nowrap">%s</td>
<td><strong>%s</strong></td>
<td><span class="badge %s">%s</span></td>
<td class="mono t2">%s</td>
<td>%s</td></tr>`,
			e.TS.Format("2006-01-02 15:04:05"), e.AgentID, cls, e.Action, e.Resource, detail)
	}
	if len(entries) == 0 {
		b.WriteString(`<tr><td colspan="5"><div class="empty">Aucune activité pour l'instant.</div></td></tr>`)
	}
	b.WriteString(`</tbody></table></div>`)
	return "audit", raw(b.String()), nil
}
