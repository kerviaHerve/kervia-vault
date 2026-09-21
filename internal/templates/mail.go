// Template registry — Mail providers (SMTP + transactional APIs).
// SMTP ports: 587 = STARTTLS, 465 = implicit TLS. Never 25 (blocked everywhere).
// SPDX-License-Identifier: AGPL-3.0

package templates

func init() {
	register(
		Template{
			Key: "smtp", Name: "SMTP (generic)", Category: "Mail",
			Description: "Any SMTP server (self-hosted, OVH, Gandi…).",
			Fields: []Field{
				{Name: "host", Label: "Server", Type: TypeText, Required: true,
					Placeholder: "smtp.example.com"},
				{Name: "port", Label: "Port", Type: TypeNumber, Required: true,
					Placeholder: "587", Min: 1, Max: 65535,
					Help: "587 = STARTTLS, 465 = TLS implicite"},
				{Name: "username", Label: "Username", Type: TypeText, Required: true},
				{Name: "password", Label: "Password", Type: TypePassword, Required: true},
				{Name: "from", Label: "From address", Type: TypeEmail, Required: false},
			},
		},
		Template{
			Key: "gmail", Name: "Gmail / Google Workspace", Category: "Mail",
			Description: "Gmail SMTP with app password, or XOAUTH2.",
			Fields: []Field{
				{Name: "username", Label: "Gmail address", Type: TypeEmail, Required: true},
				{Name: "password", Label: "App password", Type: TypePassword, Required: false,
					Help: "16 chars, myaccount.google.com → App passwords"},
				{Name: "oauth2_token", Label: "OAuth2 token", Type: TypePassword, Required: false,
					Help: "alternative to app password (XOAUTH2)"},
			},
		},
		Template{
			Key: "resend", Name: "Resend", Category: "Mail",
			Description: "Resend transactional email API.",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true,
					Placeholder: "re_..."},
				{Name: "from", Label: "Default From", Type: TypeEmail, Required: false},
			},
		},
		Template{
			Key: "sendgrid", Name: "SendGrid", Category: "Mail",
			Description: "SendGrid transactional email.",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true,
					Placeholder: "SG...."},
			},
		},
		Template{
			Key: "postmark", Name: "Postmark", Category: "Mail",
			Description: "Postmark server token.",
			Fields: []Field{
				{Name: "server_token", Label: "Server token", Type: TypePassword, Required: true},
			},
		},
		Template{
			Key: "mailgun", Name: "Mailgun", Category: "Mail",
			Description: "Mailgun sending API.",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true,
					Placeholder: "key-..."},
				{Name: "domain", Label: "Sending domain", Type: TypeText, Required: true},
				{Name: "base_url", Label: "EU base URL", Type: TypeURL, Required: false,
					Placeholder: "https://api.eu.mailgun.net", Help: "leave empty for US"},
			},
		},
		Template{
			Key: "brevo", Name: "Brevo (ex-Sendinblue)", Category: "Mail",
			Description: "Brevo transactional email.",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true,
					Placeholder: "xkeysib-..."},
			},
		},
		Template{
			Key: "ses", Name: "AWS SES", Category: "Mail",
			Description: "Amazon SES SMTP credentials.",
			Fields: []Field{
				{Name: "host", Label: "SMTP host", Type: TypeText, Required: true,
					Placeholder: "email-smtp.eu-west-3.amazonaws.com"},
				{Name: "port", Label: "Port", Type: TypeNumber, Required: true, Min: 1, Max: 65535},
				{Name: "username", Label: "SMTP username", Type: TypeText, Required: true},
				{Name: "password", Label: "SMTP password", Type: TypePassword, Required: true},
				{Name: "region", Label: "AWS region", Type: TypeText, Required: false,
					Placeholder: "eu-west-3"},
			},
		},
	)
}