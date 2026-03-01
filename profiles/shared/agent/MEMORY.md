# Durable Memory

## User

## Preferences
- For Todoist integration, use direct API calls (curl/HTTP) rather than assuming a Todoist CLI.
- Place new personal skills under the assistant profile (`profiles/assistant/agent/skills`).
- Prefer on-demand qmd memory queries over automatic prompt-time memory-card injection.
- For the assistant profile, default to provider `openai-codex` with model `gpt-5.3-codex`.
- Disable automatic memory-card generation/indexing; use on-demand qmd queries instead.

## Environment

## Constraints
- Gateway background service installs should also provision and keep personal-agentd running.

## Do Not Store
- Secrets, credentials, API keys, tokens
- Session-only or temporary task notes
