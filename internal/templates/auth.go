// Template registry — Auth providers (identité : Auth0, Clerk, Firebase).
// Un agent qui provisionne des comptes ou vérifie des tokens a besoin
// de ces clés côté serveur — jamais côté client.
//
// SPDX-License-Identifier: AGPL-3.0

package templates

func init() {
	register(
		Template{
			Key: "auth0", Name: "Auth0", Category: "Auth",
			Description: "Auth0 machine-to-machine application.",
			Fields: []Field{
				{Name: "domain", Label: "Tenant domain", Type: TypeText, Required: true,
					Placeholder: "my-tenant.eu.auth0.com"},
				{Name: "client_id", Label: "Client ID", Type: TypeText, Required: true},
				{Name: "client_secret", Label: "Client secret", Type: TypePassword, Required: true},
			},
		},
		Template{
			Key: "clerk", Name: "Clerk", Category: "Auth",
			Description: "Clerk backend secret key.",
			Fields: []Field{
				{Name: "secret_key", Label: "Secret key", Type: TypePassword, Required: true,
					Placeholder: "sk_live_... / sk_test_..."},
			},
		},
		Template{
			Key: "firebase", Name: "Firebase (service account)", Category: "Auth",
			Description: "Firebase Admin service account.",
			Fields: []Field{
				{Name: "private_key_json", Label: "Service account JSON", Type: TypeTextArea,
					Required: true, Help: "the full JSON key file (firebase console → settings)"},
				{Name: "project_id", Label: "Project ID", Type: TypeText, Required: false},
			},
		},
	)
}
