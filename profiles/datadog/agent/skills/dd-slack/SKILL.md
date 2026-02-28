---
name: dd-slack
description: Use when asked to open Datadog Slack, search/read channels/DMs/messages, or draft/send Slack messages. Run Slack browser work in a subagent to isolate noisy UI output.
---

# Slack via subagent + agent-browser

Default workspace:
- `https://dd.slack.com/`

## Rule: subagent-first

For Slack browsing/search/messaging tasks, **delegate browser execution to a subagent**.

Parent agent should:
1. Capture the user’s exact Slack task.
2. Spawn a subagent via `pi --print`.
3. Have the subagent run `agent-browser` commands.
4. Return only a concise summary to the user.

Do **not** stream raw Slack snapshots/transcript noise in the parent response.

## Subagent workflow (required)

### 1) Headed auth bootstrap (one-time / refresh)
```bash
agent-browser --headed --session dd-slack-auth open "https://dd.slack.com/"
# user completes SSO/MFA in visible window
agent-browser --session dd-slack-auth state save ~/.config/agent-browser/dd-slack-auth.json
```

### 2) Headless run for normal tasks
```bash
agent-browser --session dd-slack --state ~/.config/agent-browser/dd-slack-auth.json open "https://dd.slack.com/"
agent-browser --session dd-slack snapshot -i -C
```

Important: state must be provided at launch using `--state`.

## Navigation examples (subagent)

```bash
# Channel
agent-browser --session dd-slack --state ~/.config/agent-browser/dd-slack-auth.json open "https://dd.slack.com/archives/<CHANNEL_ID>"

# DM
agent-browser --session dd-slack --state ~/.config/agent-browser/dd-slack-auth.json open "https://dd.slack.com/archives/<DM_ID>"

# Message permalink
agent-browser --session dd-slack --state ~/.config/agent-browser/dd-slack-auth.json open "https://dd.slack.com/archives/<CHANNEL_ID>/p<MESSAGE_TS>"
```

## Sending messages

- Draft in composer first.
- **Always require explicit user confirmation before Send/Enter.**

## Subagent output contract

Subagent should return concise structured results:
- `status`: success / needs_auth / failed
- `current_url`
- `summary`: 3-10 bullets max
- `important_links`: only relevant Slack/message/doc links
- `artifacts`: screenshot paths (if any)
- `next_action`: what user should do next

## Suggested subagent prompt template

Use this when launching `pi --print`:

"""
You are a Slack browser worker. Execute only Slack browser actions with agent-browser.

Task: <USER_TASK>
Workspace: https://dd.slack.com/
Auth state: ~/.config/agent-browser/dd-slack-auth.json

Rules:
- Use headed mode only for auth bootstrap.
- Use headless mode for normal execution with --state.
- Keep output concise; no raw full snapshots unless needed for debugging.
- If auth is required, return status=needs_auth and exact user action.
- Never send a Slack message without explicit confirmation.

Return:
status, current_url, summary bullets, important_links, artifacts, next_action.
"""
