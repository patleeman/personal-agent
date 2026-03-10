---
name: dd-codex-slack
description: Use when asked to search Datadog Slack, inspect channel history, summarize threads, find unanswered questions, or gather Slack context by channel/person/time range. Also use when the user mentions aslack, Slack via Codex, or Codex apps.
---

# Datadog Slack via Codex apps

Use `bash` to call Codex through `mcp-cli` for Slack content.

Prefer this path over browser automation or guesswork when Codex Slack access is available.

## Workflow

1. Clarify the exact Slack task: channels, people, time range, filters, and desired output.
2. Run `mcp-cli call codex-cli codex ...` via `bash` with a precise natural-language prompt.
3. Ask for direct Slack permalinks as full `https://dd.slack.com/...` URLs for every returned item.
   - If a permalink cannot be returned, ask Codex to say `permalink unavailable`.
4. Pass an explicit fast model configuration for query-only work instead of inheriting the outer session's reasoning level.
5. Parse JSON from stdout.
   - Prefer `.structuredContent.content` when present.
   - Fall back to the first text block in `.content`.
6. If Codex returns citation placeholders instead of real Slack links, rerun once with a stricter permalink request.
7. If the response reports setup or auth issues, tell the user exactly which local step is missing.

## Command template

```bash
mcp-cli call codex-cli codex '{
  "prompt": "<your Slack request>. For each result include timestamp, channel, author, short excerpt, and the direct Slack permalink as a full https://dd.slack.com/... URL. If a permalink is unavailable, say \"permalink unavailable\".",
  "model": "gpt-5.1-codex-mini",
  "config": { "model_reasoning_effort": "low" },
  "sandbox": "read-only",
  "approval-policy": "never",
  "developer-instructions": "Use the connected Slack app for this request. If Slack access is unavailable, explain the exact missing setup instead of guessing. Prefer concise answers with timestamps and full Slack permalinks when available. Do not use citation placeholders if a direct Slack URL can be returned."
}'
```

## Output extraction

If you want the plain-text answer only:

```bash
mcp-cli call codex-cli codex '{...}' | jq -r '.structuredContent.content // (.content[]? | select(.type == "text") | .text)'
```

## Prompt patterns

### Search a channel
```text
Search Datadog Slack in #support-monitoring for unanswered questions from the last 24 hours about monitor scheduling or monitor evaluation. Return a concise bullet summary with timestamps and the direct Slack permalink for each result as a full https://dd.slack.com/... URL.
```

### Summarize a thread or topic
```text
Search Datadog Slack for discussion in #agent-platform during the last 7 days about Atlassian MCP auth failures. Summarize the main conclusions, open questions, and the most relevant messages, each with a full Slack permalink.
```

### Find messages from a person
```text
Search Datadog Slack for messages from Patrick Lee in the last 14 days mentioning Codex apps, Slack search, or MCP. Return the matching messages with timestamps and full Slack permalinks.
```

## Setup expectations

This workflow depends on local Codex setup:

- `~/.codex/config.toml`
  ```toml
  [features]
  apps = true
  ```
- `~/.config/mcp/mcp_servers.json` must include a `codex-cli` server using `codex mcp-server --enable apps`
- Slack must be connected in Codex via `/apps`
- If a user explicitly wants Slack's official remote MCP in `mcp-cli`, note that a plain `url: "https://mcp.slack.com/mcp"` config returns `missing_token`, and a generic `mcp-remote` wrapper also needs Slack's static OAuth client info from the Claude docs. Prefer the Codex app route unless the task is MCP setup/debugging.
