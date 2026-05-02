# Models and Providers

This doc describes the model and provider configuration model.

## Provider API types

Each provider selects a backend protocol:

| API type               | Backend                  |
| ---------------------- | ------------------------ |
| `openai-completions`   | OpenAI Completions API   |
| `openai-responses`     | OpenAI Responses API     |
| `anthropic-messages`   | Anthropic Messages API   |
| `google-generative-ai` | Google Generative AI API |

## Provider configuration

Providers are configured in `<config-root>/profiles/<profile>/models.json` under the `providers` array.

```json
{
  "id": "openai",
  "api": "openai-responses",
  "apiKey": "sk-...",
  "baseUrl": "https://api.openai.com/v1",
  "models": [
    {
      "id": "gpt-5.4",
      "name": "GPT 5.4",
      "contextWindow": 128000,
      "reasoning": true,
      "input": ["text", "image"],
      "serviceTiers": ["auto", "default", "high"]
    }
  ]
}
```

**Provider fields:**

| Field      | Description                                                           |
| ---------- | --------------------------------------------------------------------- |
| `id`       | Provider identifier, used in model references (e.g. `openai/gpt-5.4`) |
| `api`      | Backend API protocol                                                  |
| `apiKey`   | API key (alternative to auth store)                                   |
| `baseUrl`  | Base URL override for custom or proxied endpoints                     |
| `models[]` | Array of model definitions                                            |

**Model fields:**

| Field           | Description                                           |
| --------------- | ----------------------------------------------------- |
| `id`            | Model identifier, passed to the API as the model name |
| `name`          | Human-readable display name                           |
| `contextWindow` | Maximum context window in tokens                      |
| `reasoning`     | Whether the model supports reasoning/thinking mode    |
| `input`         | Supported input types: `text`, `image`, or both       |
| `serviceTiers`  | Supported service tiers: `auto`, `default`, `high`    |

## Auth store

Credentials are stored in the auth store under the provider ID. Each provider has an entry keyed by its `id`. Credentials can be:

- Stored directly in `auth.json` via the Settings UI
- Configured through environment variables
- Provided through OAuth flows

Auth types:

| Auth type     | How credentials are provided                                      |
| ------------- | ----------------------------------------------------------------- |
| `api_key`     | API key stored in auth.json or environment                        |
| `oauth`       | OAuth tokens stored in auth.json                                  |
| `environment` | Credentials resolved from environment or external provider config |

The default UI model is configured separately:

```json
{
  "defaultUiModel": "openai/gpt-5.4"
}
```

## Model references

Models are referenced as `providerId/modelId` in the codebase:

- `openai/gpt-5.4`
- `anthropic/claude-sonnet-4-20250514`
- `google/gemini-2.5-pro`

## Provider overrides

Machine-local overrides live in `<config-root>/local/`. These override the profile-level model/provider config without modifying the shared profile config.

## Related docs

- [Configuration](./configuration.md)
- [Dictation Transcription](./dictation-transcription.md)
