// Template registry — kervia internal services + registry plumbing.
// SPDX-License-Identifier: AGPL-3.0

package templates

// allTemplates is the registry; orderedKeys keeps a stable listing order.
var (
	allTemplates = map[string]Template{}
	orderedKeys  []string
)

func register(ts ...Template) {
	for _, t := range ts {
		if _, dup := allTemplates[t.Key]; dup {
			panic("templates: duplicate key " + t.Key)
		}
		allTemplates[t.Key] = t
		orderedKeys = append(orderedKeys, t.Key)
	}
}

func init() {
	// kervia internal services
	register(
		Template{
			Key: "crawl4ai", Name: "crawl4ai (kervia)", Category: "Kervia",
			Description: "crawl4ai API bearer token.",
			Fields: []Field{
				{Name: "api_token", Label: "API token", Type: TypePassword, Required: true},
				{Name: "base_url", Label: "Base URL", Type: TypeURL, Required: false,
					Placeholder: "https://s-crawl4ai.kervia.ch"},
			},
		},
		Template{
			Key: "searxng", Name: "SearXNG (kervia)", Category: "Kervia",
			Description: "SearXNG search API.",
			Fields: []Field{
				{Name: "base_url", Label: "Base URL", Type: TypeURL, Required: false,
					Placeholder: "https://s-searxng.kervia.ch"},
			},
		},
		Template{
			Key: "npm-admin", Name: "NPM admin (kervia)", Category: "Kervia",
			Description: "Nginx Proxy Manager admin.",
			Fields: []Field{
				{Name: "email", Label: "Email", Type: TypeEmail, Required: true},
				{Name: "password", Label: "Password", Type: TypePassword, Required: true},
				{Name: "base_url", Label: "Base URL", Type: TypeURL, Required: false,
					Placeholder: "https://s-npm.kervia.ch"},
			},
		},
	)
}