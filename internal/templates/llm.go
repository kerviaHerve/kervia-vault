// Template registry — LLM providers.
// Field names follow each provider's official SDK terminology.
// SPDX-License-Identifier: AGPL-3.0

package templates

func init() {
	register(
		Template{
			Key: "openai", Name: "OpenAI", Category: "LLM",
			Description: "OpenAI API (GPT models, embeddings, DALL·E).",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true,
					Placeholder: "sk-...", Help: "platform.openai.com → API keys"},
				{Name: "org_id", Label: "Organization ID", Type: TypeText, Required: false,
					Placeholder: "org-..."},
				{Name: "base_url", Label: "Base URL", Type: TypeURL, Required: false,
					Placeholder: "https://api.openai.com/v1", Help: "override for proxies/Azure"},
			},
		},
		Template{
			Key: "anthropic", Name: "Anthropic", Category: "LLM",
			Description: "Anthropic API (Claude models).",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true,
					Placeholder: "sk-ant-..."},
				{Name: "base_url", Label: "Base URL", Type: TypeURL, Required: false,
					Placeholder: "https://api.anthropic.com"},
			},
		},
		Template{
			Key: "gemini", Name: "Google Gemini", Category: "LLM",
			Description: "Google AI Studio / Gemini API.",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true,
					Placeholder: "AIza..."},
				{Name: "project_id", Label: "Project ID", Type: TypeText, Required: false},
			},
		},
		Template{
			Key: "mistral", Name: "Mistral AI", Category: "LLM",
			Description: "Mistral API (open and commercial models).",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true},
			},
		},
		Template{
			Key: "groq", Name: "Groq", Category: "LLM",
			Description: "Groq ultra-fast inference (Llama, Mixtral).",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true,
					Placeholder: "gsk_..."},
			},
		},
		Template{
			Key: "deepseek", Name: "DeepSeek", Category: "LLM",
			Description: "DeepSeek API.",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true},
			},
		},
		Template{
			Key: "xai", Name: "xAI (Grok)", Category: "LLM",
			Description: "xAI API (Grok models).",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true},
			},
		},
		Template{
			Key: "openrouter", Name: "OpenRouter", Category: "LLM",
			Description: "OpenRouter — one key, many models.",
			Fields: []Field{
				{Name: "api_key", Label: "API key", Type: TypePassword, Required: true,
					Placeholder: "sk-or-..."},
			},
		},
		Template{
			Key: "ollama", Name: "Ollama (self-hosted)", Category: "LLM",
			Description: "Local Ollama server.",
			Fields: []Field{
				{Name: "base_url", Label: "Server URL", Type: TypeURL, Required: true,
					Placeholder: "http://ollama.kervia.ch:11434"},
				{Name: "api_key", Label: "API key (if any)", Type: TypePassword, Required: false},
			},
		},
	)
}