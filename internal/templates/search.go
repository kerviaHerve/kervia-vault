// Template registry — Search engines (API de recherche indexée).
//
// SPDX-License-Identifier: AGPL-3.0

package templates

func init() {
	register(
		Template{
			Key: "algolia", Name: "Algolia", Category: "Search",
			Description: "Algolia application (admin key).",
			Fields: []Field{
				{Name: "application_id", Label: "Application ID", Type: TypeText, Required: true},
				{Name: "admin_api_key", Label: "Admin API key", Type: TypePassword, Required: true},
				{Name: "search_api_key", Label: "Search-only API key", Type: TypePassword, Required: false,
					Help: "safe for the frontend"},
			},
		},
		Template{
			Key: "meilisearch", Name: "Meilisearch", Category: "Search",
			Description: "Meilisearch (self-hosted usually) master key.",
			Fields: []Field{
				{Name: "base_url", Label: "Base URL", Type: TypeURL, Required: true,
					Placeholder: "https://search.example.com"},
				{Name: "master_key", Label: "Master key", Type: TypePassword, Required: false},
				{Name: "search_key", Label: "Search key", Type: TypePassword, Required: false},
			},
		},
	)
}
