// Template registry — Hosting / PaaS (déploiement d'applications).
// Chacun expose un token de déploiement ou une clé API — les agents
// CI/CD en ont besoin autant que des registry Docker.
//
// SPDX-License-Identifier: AGPL-3.0

package templates

func init() {
	register(
		Template{
			Key: "vercel", Name: "Vercel", Category: "Hosting",
			Description: "Vercel deploy token.",
			Fields: []Field{
				{Name: "token", Label: "Token", Type: TypePassword, Required: true},
				{Name: "team_id", Label: "Team ID", Type: TypeText, Required: false},
			},
		},
		Template{
			Key: "netlify", Name: "Netlify", Category: "Hosting",
			Description: "Netlify personal access token.",
			Fields: []Field{
				{Name: "token", Label: "Token", Type: TypePassword, Required: true,
					Placeholder: "nfp_..."},
			},
		},
		Template{
			Key: "railway", Name: "Railway", Category: "Hosting",
			Description: "Railway API token.",
			Fields: []Field{
				{Name: "token", Label: "Token", Type: TypePassword, Required: true},
			},
		},
		Template{
			Key: "render", Name: "Render", Category: "Hosting",
			Description: "Render deploy/API key.",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true,
					Placeholder: "rnd_..."},
			},
		},
		Template{
			Key: "fly-io", Name: "Fly.io", Category: "Hosting",
			Description: "Fly.io deploy token.",
			Fields: []Field{
				{Name: "token", Label: "Token", Type: TypePassword, Required: true,
					Placeholder: "Fly... (fly tokens create)"},
			},
		},
		Template{
			Key: "heroku", Name: "Heroku", Category: "Hosting",
			Description: "Heroku API key.",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true},
			},
		},
	)
}
