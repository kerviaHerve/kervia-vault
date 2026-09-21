package templates

// Cloud provider templates + generic web auth patterns (see templates.go
// for the package comment).
//
// SPDX-License-Identifier: AGPL-3.0

func init() {
	register(
		Template{
			Key: "cloudflare", Name: "Cloudflare", Category: "Cloud",
			Description: "Cloudflare API token (scoped, zone or account).",
			Fields: []Field{
				{Name: "api_token", Label: "API token", Type: TypePassword, Required: true,
					Help: "dash.cloudflare.com → My Profile → API Tokens"},
				{Name: "account_id", Label: "Account ID", Type: TypeText, Required: false},
				{Name: "zone_id", Label: "Zone ID", Type: TypeText, Required: false,
					Help: "for zone-scoped tokens"},
			},
		},
		Template{
			Key: "aws", Name: "AWS access keys", Category: "Cloud",
			Description: "AWS IAM access key pair.",
			Fields: []Field{
				{Name: "access_key_id", Label: "Access key ID", Type: TypeText, Required: true,
					Placeholder: "AKIA..."},
				{Name: "secret_access_key", Label: "Secret access key", Type: TypePassword, Required: true},
				{Name: "region", Label: "Default region", Type: TypeText, Required: false,
					Placeholder: "eu-west-3"},
			},
		},
		Template{
			Key: "gcp-service-account", Name: "GCP service account", Category: "Cloud",
			Description: "Google Cloud service account JSON key.",
			Fields: []Field{
				{Name: "private_key_json", Label: "Service account JSON", Type: TypeTextArea,
					Required: true, Help: "the full JSON key file"},
				{Name: "project_id", Label: "Project ID", Type: TypeText, Required: false},
			},
		},
		Template{
			Key: "azure", Name: "Azure", Category: "Cloud",
			Description: "Azure service principal.",
			Fields: []Field{
				{Name: "tenant_id", Label: "Tenant ID", Type: TypeText, Required: true},
				{Name: "client_id", Label: "Client ID", Type: TypeText, Required: true},
				{Name: "client_secret", Label: "Client secret", Type: TypePassword, Required: true},
				{Name: "subscription_id", Label: "Subscription ID", Type: TypeText, Required: false},
			},
		},
		Template{
			Key: "hetzner", Name: "Hetzner Cloud", Category: "Cloud",
			Description: "Hetzner Cloud API token.",
			Fields: []Field{
				{Name: "api_token", Label: "API token", Type: TypePassword, Required: true},
			},
		},
		Template{
			Key: "ovh", Name: "OVHcloud", Category: "Cloud",
			Description: "OVH API credentials (application key + secret).",
			Fields: []Field{
				{Name: "application_key", Label: "Application key", Type: TypePassword, Required: true},
				{Name: "application_secret", Label: "Application secret", Type: TypePassword, Required: true},
				{Name: "consumer_key", Label: "Consumer key", Type: TypePassword, Required: true},
				{Name: "endpoint", Label: "Endpoint", Type: TypeURL, Required: false,
					Placeholder: "https://eu.api.ovh.com"},
			},
		},
		Template{
			Key: "scaleway", Name: "Scaleway", Category: "Cloud",
			Description: "Scaleway API access key + secret.",
			Fields: []Field{
				{Name: "access_key", Label: "Access key", Type: TypeText, Required: true},
				{Name: "secret_key", Label: "Secret key", Type: TypePassword, Required: true},
				{Name: "organization_id", Label: "Organization ID", Type: TypeText, Required: false},
				{Name: "region", Label: "Region", Type: TypeText, Required: false,
					Placeholder: "fr-par"},
			},
		},

		// ---- generic web auth patterns ----
		Template{
			Key: "bearer", Name: "Bearer token (generic)", Category: "Web/API",
			Description: "Any API using Authorization: Bearer.",
			Fields: []Field{
				{Name: "token", Label: "Token", Type: TypePassword, Required: true},
				{Name: "base_url", Label: "API base URL", Type: TypeURL, Required: true,
					Placeholder: "https://api.example.com"},
			},
		},
		Template{
			Key: "basic-auth", Name: "Basic auth (generic)", Category: "Web/API",
			Description: "Username + password for HTTP Basic auth.",
			Fields: []Field{
				{Name: "username", Label: "Username", Type: TypeText, Required: true},
				{Name: "password", Label: "Password", Type: TypePassword, Required: true},
				{Name: "base_url", Label: "Base URL", Type: TypeURL, Required: false},
			},
		},
		Template{
			Key: "api-key", Name: "API key (generic)", Category: "Web/API",
			Description: "API key passed in a custom header or query param.",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true},
				{Name: "header_name", Label: "Header name", Type: TypeText, Required: false,
					Placeholder: "X-API-Key", Help: "leave empty for ?api_key= query param"},
				{Name: "base_url", Label: "Base URL", Type: TypeURL, Required: false},
			},
		},
		Template{
			Key: "oauth2-client", Name: "OAuth2 client", Category: "Web/API",
			Description: "OAuth2 client credentials flow.",
			Fields: []Field{
				{Name: "client_id", Label: "Client ID", Type: TypeText, Required: true},
				{Name: "client_secret", Label: "Client secret", Type: TypePassword, Required: true},
				{Name: "token_url", Label: "Token endpoint", Type: TypeURL, Required: true},
				{Name: "scopes", Label: "Scopes", Type: TypeText, Required: false},
			},
		},
		Template{
			Key: "hmac-webhook", Name: "HMAC webhook", Category: "Web/API",
			Description: "Webhook signature secret (HMAC).",
			Fields: []Field{
				{Name: "secret", Label: "Signing secret", Type: TypePassword, Required: true},
				{Name: "webhook_url", Label: "Webhook URL", Type: TypeURL, Required: false},
			},
		},
	)
}