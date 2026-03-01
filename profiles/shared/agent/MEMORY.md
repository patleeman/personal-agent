# Durable Memory

## User

## Preferences
- For Todoist integration, use direct API calls (curl/HTTP) rather than assuming a Todoist CLI.
- Place new personal skills under the assistant profile (`profiles/assistant/agent/skills`).
- Prefer on-demand qmd memory queries over automatic prompt-time memory-card injection.

## Environment

## Constraints
- Gateway background service installs should also provision and keep personal-agentd running.

## Do Not Store
- Secrets, credentials, API keys, tokens
- Session-only or temporary task notes
