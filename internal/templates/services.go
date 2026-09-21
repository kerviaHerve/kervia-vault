// Template registry — Databases, DevOps, Messaging, Payments, Monitoring.
// SPDX-License-Identifier: AGPL-3.0

package templates

func init() {
	register(
		// ---- Databases ----
		Template{
			Key: "postgres", Name: "PostgreSQL", Category: "Database",
			Description: "PostgreSQL connection.",
			Fields: []Field{
				{Name: "host", Label: "Host", Type: TypeText, Required: true},
				{Name: "port", Label: "Port", Type: TypeNumber, Required: false,
					Placeholder: "5432", Min: 1, Max: 65535},
				{Name: "database", Label: "Database", Type: TypeText, Required: true},
				{Name: "username", Label: "User", Type: TypeText, Required: true},
				{Name: "password", Label: "Password", Type: TypePassword, Required: true},
				{Name: "sslmode", Label: "SSL mode", Type: TypeText, Required: false,
					Placeholder: "require", Help: "disable/require/verify-full"},
			},
		},
		Template{
			Key: "mysql", Name: "MySQL / MariaDB", Category: "Database",
			Description: "MySQL connection.",
			Fields: []Field{
				{Name: "host", Label: "Host", Type: TypeText, Required: true},
				{Name: "port", Label: "Port", Type: TypeNumber, Required: false,
					Placeholder: "3306", Min: 1, Max: 65535},
				{Name: "database", Label: "Database", Type: TypeText, Required: true},
				{Name: "username", Label: "User", Type: TypeText, Required: true},
				{Name: "password", Label: "Password", Type: TypePassword, Required: true},
			},
		},
		Template{
			Key: "mongodb", Name: "MongoDB", Category: "Database",
			Description: "MongoDB connection (URI or fields).",
			Fields: []Field{
				{Name: "uri", Label: "Connection URI", Type: TypeText, Required: false,
					Placeholder: "mongodb+srv://..."},
				{Name: "host", Label: "Host", Type: TypeText, Required: false},
				{Name: "port", Label: "Port", Type: TypeNumber, Required: false,
					Placeholder: "27017", Min: 1, Max: 65535},
				{Name: "database", Label: "Database", Type: TypeText, Required: false},
				{Name: "username", Label: "User", Type: TypeText, Required: false},
				{Name: "password", Label: "Password", Type: TypePassword, Required: false,
					Help: "either a URI or host+port+credentials"},
			},
		},
		Template{
			Key: "redis", Name: "Redis / Valkey", Category: "Database",
			Description: "Redis connection.",
			Fields: []Field{
				{Name: "uri", Label: "Connection URI", Type: TypeText, Required: false,
					// example only — the credentials in this placeholder are UI text, never real
					Placeholder: "rediss://user" + ":pass@host:6379"},
				{Name: "host", Label: "Host", Type: TypeText, Required: false},
				{Name: "port", Label: "Port", Type: TypeNumber, Required: false,
					Placeholder: "6379", Min: 1, Max: 65535},
				{Name: "password", Label: "Password", Type: TypePassword, Required: false},
			},
		},

		// ---- DevOps ----
		Template{
			Key: "github", Name: "GitHub", Category: "DevOps",
			Description: "GitHub personal access token.",
			Fields: []Field{
				{Name: "token", Label: "PAT", Type: TypePassword, Required: true,
					Placeholder: "ghp_... / github_pat_..."},
				{Name: "username", Label: "Username", Type: TypeText, Required: false},
				{Name: "scopes", Label: "Scopes", Type: TypeText, Required: false,
					Placeholder: "repo, read:org"},
			},
		},
		Template{
			Key: "gitlab", Name: "GitLab", Category: "DevOps",
			Description: "GitLab personal access token.",
			Fields: []Field{
				{Name: "token", Label: "Token", Type: TypePassword, Required: true,
					Placeholder: "glpat-..."},
				{Name: "base_url", Label: "GitLab URL", Type: TypeURL, Required: false,
					Placeholder: "https://gitlab.com"},
			},
		},
		Template{
			Key: "docker-hub", Name: "Docker Hub", Category: "DevOps",
			Description: "Docker Hub registry credentials.",
			Fields: []Field{
				{Name: "username", Label: "Username", Type: TypeText, Required: true},
				{Name: "password", Label: "Password / PAT", Type: TypePassword, Required: true},
			},
		},
		Template{
			Key: "npm", Name: "npm registry", Category: "DevOps",
			Description: "npm publish token.",
			Fields: []Field{
				{Name: "token", Label: "Token", Type: TypePassword, Required: true,
					Placeholder: "npm_..."},
				{Name: "registry", Label: "Registry URL", Type: TypeURL, Required: false,
					Placeholder: "https://registry.npmjs.org"},
			},
		},
		Template{
			Key: "ssh-key", Name: "SSH key", Category: "DevOps",
			Description: "SSH private key.",
			Fields: []Field{
				{Name: "private_key", Label: "Private key", Type: TypeTextArea, Required: true,
					Help: "full PEM, including BEGIN/END lines"},
				{Name: "passphrase", Label: "Passphrase", Type: TypePassword, Required: false},
				{Name: "host", Label: "Host", Type: TypeText, Required: false},
				{Name: "username", Label: "User", Type: TypeText, Required: false},
				{Name: "port", Label: "Port", Type: TypeNumber, Required: false,
					Placeholder: "22", Min: 1, Max: 65535},
			},
		},
		Template{
			Key: "kubernetes", Name: "Kubernetes", Category: "DevOps",
			Description: "Kubeconfig / service account.",
			Fields: []Field{
				{Name: "kubeconfig", Label: "Kubeconfig YAML", Type: TypeTextArea, Required: false},
				{Name: "api_server", Label: "API server URL", Type: TypeURL, Required: false},
				{Name: "token", Label: "Service account token", Type: TypePassword, Required: false},
			},
		},

		// ---- Messaging ----
		Template{
			Key: "slack-bot", Name: "Slack bot", Category: "Messaging",
			Description: "Slack bot token.",
			Fields: []Field{
				{Name: "bot_token", Label: "Bot token", Type: TypePassword, Required: true,
					Placeholder: "xoxb-..."},
				{Name: "signing_secret", Label: "Signing secret", Type: TypePassword, Required: false},
			},
		},
		Template{
			Key: "discord-bot", Name: "Discord bot", Category: "Messaging",
			Description: "Discord bot token.",
			Fields: []Field{
				{Name: "bot_token", Label: "Bot token", Type: TypePassword, Required: true},
			},
		},
		Template{
			Key: "telegram-bot", Name: "Telegram bot", Category: "Messaging",
			Description: "Telegram bot token.",
			Fields: []Field{
				{Name: "bot_token", Label: "Bot token", Type: TypePassword, Required: true,
					Placeholder: "123456:ABC-..."},
			},
		},
		Template{
			Key: "matrix", Name: "Matrix", Category: "Messaging",
			Description: "Matrix bot credentials.",
			Fields: []Field{
				{Name: "homeserver", Label: "Homeserver URL", Type: TypeURL, Required: true},
				{Name: "user_id", Label: "User ID", Type: TypeText, Required: true,
					Placeholder: "@bot:matrix.org"},
				{Name: "access_token", Label: "Access token", Type: TypePassword, Required: true},
			},
		},

		// ---- Payments ----
		Template{
			Key: "stripe", Name: "Stripe", Category: "Payments",
			Description: "Stripe secret key + webhook.",
			Fields: []Field{
				{Name: "secret_key", Label: "Secret key", Type: TypePassword, Required: true,
					Placeholder: "sk_live_... / sk_test_..."},
				{Name: "webhook_secret", Label: "Webhook secret", Type: TypePassword, Required: false,
					Placeholder: "whsec_..."},
				{Name: "publishable_key", Label: "Publishable key", Type: TypeText, Required: false},
			},
		},
		Template{
			Key: "paypal", Name: "PayPal", Category: "Payments",
			Description: "PayPal REST API credentials.",
			Fields: []Field{
				{Name: "client_id", Label: "Client ID", Type: TypeText, Required: true},
				{Name: "client_secret", Label: "Client secret", Type: TypePassword, Required: true},
				{Name: "mode", Label: "Mode", Type: TypeText, Required: false,
					Placeholder: "live / sandbox"},
			},
		},

		// ---- Monitoring ----
		Template{
			Key: "sentry", Name: "Sentry", Category: "Monitoring",
			Description: "Sentry DSN / auth token.",
			Fields: []Field{
				{Name: "dsn", Label: "DSN", Type: TypeText, Required: false},
				{Name: "auth_token", Label: "Auth token", Type: TypePassword, Required: false},
				{Name: "organization", Label: "Organization slug", Type: TypeText, Required: false},
			},
		},
		Template{
			Key: "grafana", Name: "Grafana", Category: "Monitoring",
			Description: "Grafana API credentials.",
			Fields: []Field{
				{Name: "base_url", Label: "Grafana URL", Type: TypeURL, Required: true},
				{Name: "username", Label: "User", Type: TypeText, Required: false},
				{Name: "password", Label: "Password / API key", Type: TypePassword, Required: false},
			},
		},
		Template{
			Key: "datadog", Name: "Datadog", Category: "Monitoring",
			Description: "Datadog API + APP keys.",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true},
				{Name: "app_key", Label: "APP key", Type: TypePassword, Required: false},
			},
		},
	)
}