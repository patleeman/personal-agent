---
name: dd-slack
description: Use when asked to open Datadog Slack, check unreads, search/read channels/DMs/messages, or draft/send Slack messages. Run Slack browser work in a subagent to isolate noisy UI output.
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*), Bash(pi:*)
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

## Required session startup (important)

`--state` only applies when the browser session is launched.
If a session daemon already exists, `--state` can be ignored.

Always reset the target session before opening Slack with state:

```bash
agent-browser --session dd-slack close || true
agent-browser --session dd-slack --state ~/.config/agent-browser/dd-slack-auth.json open "https://dd.slack.com/"
agent-browser --session dd-slack snapshot -i -C
```

Use this same pattern for any named Slack session (e.g. `dd-slack-search`, `ddslack`).

## Auth bootstrap (one-time / refresh)

```bash
agent-browser --session dd-slack-auth close || true
agent-browser --headed --session dd-slack-auth open "https://dd.slack.com/"
# user completes SSO/MFA in visible window
agent-browser --session dd-slack-auth state save ~/.config/agent-browser/dd-slack-auth.json
```

If state is missing/expired, return `status=needs_auth` with exact user action.

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

## Reference docs

- Common task flows: `references/workflows.md`
- Troubleshooting: `references/troubleshooting.md`
- Reusable subagent prompt: `templates/subagent-prompt.md`
