# Providers & Models

Providers connect the agent to LLM APIs. Models define which specific model to use and its capabilities (context window, reasoning, cost).

## Supported Providers

| Provider       | Auth Types                      | API Type           |
| -------------- | ------------------------------- | ------------------ |
| Anthropic      | API key, OAuth (Claude Pro/Max) | anthropic          |
| OpenAI         | API key                         | openai-completions |
| Google         | API key                         | google-ai          |
| GitHub Copilot | OAuth                           | openai-completions |
| Custom         | API key + base URL              | openai-completions |

## Authentication

Credentials are resolved in this order:

1. **Environment variables** — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
2. **Auth file** — stored in `<config-root>/auth.json`, managed through Settings
3. **OAuth login** — subscription providers like Claude Pro/Max and GitHub Copilot use OAuth via `/login` in the agent

### Subscription login

Start the agent and run:

```
/login
```

Then select a provider. Built-in subscription logins include Claude Pro/Max, ChatGPT Plus/Pro (Codex), and GitHub Copilot.

### API key setup

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Or configure through Settings.

## Model Registry

Models are discovered from provider APIs and configured entries. Each model has:

| Property        | Description                                             |
| --------------- | ------------------------------------------------------- |
| `id`            | Model identifier (e.g., `claude-sonnet-4-20250514`)     |
| `provider`      | Provider name (e.g., `anthropic`)                       |
| `contextWindow` | Maximum context tokens                                  |
| `maxTokens`     | Maximum output tokens                                   |
| `reasoning`     | Whether the model supports reasoning/thinking           |
| `cost`          | Cost per token (input, output, cache read, cache write) |

## Selecting a Model

Set defaults in Settings or config.json:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium"
}
```

During a conversation, switch models using the model picker in the desktop UI. Available models are listed from all configured providers.

## Thinking Levels

| Level     | Description               |
| --------- | ------------------------- |
| `off`     | No extended thinking      |
| `minimal` | Minimum reasoning tokens  |
| `low`     | Low reasoning budget      |
| `medium`  | Moderate reasoning budget |
| `high`    | High reasoning budget     |
| `xhigh`   | Maximum reasoning budget  |

Not all models support all thinking levels. The available levels depend on the model's capabilities.

## Provider Config

Configure providers in Settings. Each provider entry specifies:

- Provider type (Anthropic, OpenAI, Google, etc.)
- API key or OAuth credentials
- Base URL (for custom OpenAI-compatible endpoints)
- Display name
