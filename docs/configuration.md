# Configuration

Personal Agent uses layered file-based configuration with environment variable overrides. Settings are merged from multiple sources with a clear precedence order.

## Config File Locations

| File                              | Purpose                   | Precedence |
| --------------------------------- | ------------------------- | ---------- |
| `<config-root>/config.json`       | Machine-level base config | Lowest     |
| `<config-root>/local/config.json` | Local overrides           | Medium     |
| Environment variables             | Runtime overrides         | Highest    |

`<config-root>` defaults to `<state-root>/config`. `<state-root>` defaults to `~/.local/state/personal-agent`.

## Base config.json

```json
{
  "instructionFiles": ["instructions/base.md", "instructions/code-style.md"],
  "vaultRoot": "~/Documents/my-vault",
  "knowledgeBaseRepoUrl": "git@github.com:user/repo.git",
  "knowledgeBaseBranch": "main",
  "theme": "dark",
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium"
}
```

### Sections

| Key                    | Type     | Description                                  |
| ---------------------- | -------- | -------------------------------------------- |
| `instructionFiles`     | string[] | Paths to instruction markdown files          |
| `vaultRoot`            | string   | Override the vault root directory            |
| `knowledgeBaseRepoUrl` | string   | Git repo URL for KB sync                     |
| `knowledgeBaseBranch`  | string   | Branch for KB sync (default: remote default) |
| `theme`                | string   | `"light"`, `"dark"`, or `"system"`           |
| `defaultProvider`      | string   | Default API provider                         |
| `defaultModel`         | string   | Default model ID                             |
| `defaultThinkingLevel` | string   | Default reasoning level                      |

## Environment Variables

| Variable                    | Overrides               | Example                     |
| --------------------------- | ----------------------- | --------------------------- |
| `PERSONAL_AGENT_VAULT_ROOT` | Vault root directory    | `~/Documents/pa-vault`      |
| `PERSONAL_AGENT_STATE_ROOT` | Runtime state root      | `~/.local/state/pa`         |
| `ANTHROPIC_API_KEY`         | Anthropic API key       | `sk-ant-...`                |
| `OPENAI_API_KEY`            | OpenAI API key          | `sk-...`                    |
| `GOOGLE_API_KEY`            | Google AI API key       | `AIza...`                   |
| `EXA_API_KEY`               | Exa search API key      |                             |
| `MCP_CONFIG_PATH`           | MCP servers config path | `/path/to/mcp_servers.json` |

## Vault Root Resolution

The effective vault root resolves in this order:

1. `PERSONAL_AGENT_VAULT_ROOT` environment variable
2. Managed KB mirror (`<state-root>/knowledge-base/repo`) when `knowledgeBaseRepoUrl` is set
3. `vaultRoot` from config.json
4. `~/Documents/personal-agent`

## Auth Store

Credentials are stored in `<config-root>/auth.json`. This file stores API keys and OAuth tokens. Managed through the Settings UI — manual editing is not recommended.
