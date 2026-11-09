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
		Template{
			Key: "elasticsearch", Name: "Elasticsearch", Category: "Database",
			Description: "Elasticsearch connection (fields or API key).",
			Fields: []Field{
				{Name: "host", Label: "Host", Type: TypeText, Required: false,
					Placeholder: "es.example.com"},
				{Name: "port", Label: "Port", Type: TypeNumber, Required: false,
					Placeholder: "9200", Min: 1, Max: 65535},
				{Name: "username", Label: "User", Type: TypeText, Required: false},
				{Name: "password", Label: "Password", Type: TypePassword, Required: false},
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: false,
					Help: "alternative to user/password (encoded base64)"},
			},
		},
		Template{
			Key: "clickhouse", Name: "ClickHouse", Category: "Database",
			Description: "ClickHouse HTTP connection.",
			Fields: []Field{
				{Name: "host", Label: "Host", Type: TypeText, Required: true},
				{Name: "port", Label: "Port", Type: TypeNumber, Required: false,
					Placeholder: "8443", Min: 1, Max: 65535,
					Help: "8443 = HTTPS, 8123 = HTTP"},
				{Name: "database", Label: "Database", Type: TypeText, Required: false},
				{Name: "username", Label: "User", Type: TypeText, Required: true},
				{Name: "password", Label: "Password", Type: TypePassword, Required: false},
			},
		},
		Template{
			Key: "influxdb", Name: "InfluxDB", Category: "Database",
			Description: "InfluxDB v2 token.",
			Fields: []Field{
				{Name: "base_url", Label: "Base URL", Type: TypeURL, Required: true,
					Placeholder: "https://eu-central-1-1.aws.cloud2.influxdata.com"},
				{Name: "token", Label: "API token", Type: TypePassword, Required: true},
				{Name: "org", Label: "Org", Type: TypeText, Required: false},
				{Name: "bucket", Label: "Bucket", Type: TypeText, Required: false},
			},
		},
		Template{
			Key: "neo4j", Name: "Neo4j", Category: "Database",
			Description: "Neo4j connection (bolt).",
			Fields: []Field{
				{Name: "uri", Label: "Connection URI", Type: TypeText, Required: true,
					Placeholder: "neo4j+s://xxx.databases.neo4j.io",
					Help: "bolt:// n'est pas une URL http(s) — champ texte"},
				{Name: "username", Label: "User", Type: TypeText, Required: false,
					Placeholder: "neo4j"},
				{Name: "password", Label: "Password", Type: TypePassword, Required: false},
			},
		},
		Template{
			Key: "cassandra", Name: "Cassandra / ScyllaDB", Category: "Database",
			Description: "Cassandra connection.",
			Fields: []Field{
				{Name: "hosts", Label: "Hosts", Type: TypeText, Required: true,
					Placeholder: "cass1.example.com,cass2.example.com",
					Help: "comma-separated list of contact points"},
				{Name: "username", Label: "User", Type: TypeText, Required: false},
				{Name: "password", Label: "Password", Type: TypePassword, Required: false},
				{Name: "local_datacenter", Label: "Local datacenter", Type: TypeText, Required: false,
					Placeholder: "datacenter1"},
			},
		},
		Template{
			Key: "supabase", Name: "Supabase", Category: "Database",
			Description: "Supabase project (service role = full DB access).",
			Fields: []Field{
				{Name: "project_url", Label: "Project URL", Type: TypeURL, Required: true,
					Placeholder: "https://xxx.supabase.co"},
				{Name: "service_role_key", Label: "Service role key", Type: TypePassword, Required: true,
					Help: "bypasses RLS — server-side only"},
				{Name: "anon_key", Label: "Anon key", Type: TypePassword, Required: false},
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
		Template{
			Key: "gitea", Name: "Gitea / Forgejo", Category: "DevOps",
			Description: "Gitea (or Forgejo) access token.",
			Fields: []Field{
				{Name: "base_url", Label: "Instance URL", Type: TypeURL, Required: true,
					Placeholder: "https://git.example.com"},
				{Name: "token", Label: "Token", Type: TypePassword, Required: true},
				{Name: "username", Label: "Username", Type: TypeText, Required: false},
			},
		},
		Template{
			Key: "bitbucket", Name: "Bitbucket", Category: "DevOps",
			Description: "Bitbucket app password.",
			Fields: []Field{
				{Name: "username", Label: "Username", Type: TypeText, Required: true},
				{Name: "app_password", Label: "App password", Type: TypePassword, Required: true},
				{Name: "workspace", Label: "Workspace", Type: TypeText, Required: false},
			},
		},
		Template{
			Key: "jenkins", Name: "Jenkins", Category: "DevOps",
			Description: "Jenkins API token.",
			Fields: []Field{
				{Name: "base_url", Label: "Jenkins URL", Type: TypeURL, Required: true},
				{Name: "username", Label: "User", Type: TypeText, Required: true},
				{Name: "api_token", Label: "API token", Type: TypePassword, Required: true},
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
		Template{
			Key: "twilio", Name: "Twilio (SMS)", Category: "Messaging",
			Description: "Twilio SMS/voice credentials.",
			Fields: []Field{
				{Name: "account_sid", Label: "Account SID", Type: TypeText, Required: true,
					Placeholder: "AC..."},
				{Name: "auth_token", Label: "Auth token", Type: TypePassword, Required: true},
				{Name: "from_number", Label: "From number", Type: TypeText, Required: false,
					Placeholder: "+33..."},
			},
		},
		Template{
			// Zoom Server-to-Server OAuth : les 3 identifiants du panneau
			// « App credentials » d'une S2S app (aucun user, aucun refresh
			// token — le token API se mint depuis ces trois-là).
			Key: "zoom", Name: "Zoom (Server-to-Server OAuth)", Category: "Messaging",
			Description: "Zoom Server-to-Server OAuth app credentials (meetings, webinars, users API).",
			Fields: []Field{
				{Name: "account_id", Label: "Account ID", Type: TypeText, Required: true,
					Placeholder: "123456789012",
					Help: "App credentials panel — numeric account ID"},
				{Name: "client_id", Label: "Client ID", Type: TypeText, Required: true,
					Placeholder: "AbCdEfGhIjKlMnOpQrStUv"},
				{Name: "client_secret", Label: "Client secret", Type: TypePassword, Required: true},
			},
		},
		Template{
			Key: "pushover", Name: "Pushover", Category: "Messaging",
			Description: "Pushover notifications.",
			Fields: []Field{
				{Name: "user_key", Label: "User key", Type: TypeText, Required: true},
				{Name: "app_token", Label: "App token", Type: TypePassword, Required: true},
			},
		},
		Template{
			Key: "ntfy", Name: "ntfy", Category: "Messaging",
			Description: "ntfy push notifications (self-hosted usually).",
			Fields: []Field{
				{Name: "base_url", Label: "Server URL", Type: TypeURL, Required: false,
					Placeholder: "https://ntfy.sh", Help: "leave empty for ntfy.sh"},
				{Name: "topic", Label: "Topic", Type: TypeText, Required: true},
				{Name: "username", Label: "Username", Type: TypeText, Required: false},
				{Name: "password", Label: "Password / token", Type: TypePassword, Required: false},
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
		Template{
			Key: "mollie", Name: "Mollie", Category: "Payments",
			Description: "Mollie payments API key.",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true,
					Placeholder: "live_... / test_..."},
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
		Template{
			Key: "pagerduty", Name: "PagerDuty", Category: "Monitoring",
			Description: "PagerDuty REST API key and/or Events routing key.",
			Fields: []Field{
				{Name: "api_key", Label: "REST API key", Type: TypePassword, Required: false,
					Placeholder: "u+..."},
				{Name: "routing_key", Label: "Events routing key", Type: TypePassword, Required: false,
					Help: "integration key for Events API v2"},
			},
		},
		Template{
			Key: "uptime-kuma", Name: "Uptime Kuma", Category: "Monitoring",
			Description: "Uptime Kuma (self-hosted) credentials.",
			Fields: []Field{
				{Name: "base_url", Label: "Instance URL", Type: TypeURL, Required: true},
				{Name: "username", Label: "Username", Type: TypeText, Required: true},
				{Name: "password", Label: "Password", Type: TypePassword, Required: true},
			},
		},
	)
}