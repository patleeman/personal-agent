# Slack troubleshooting

## `--state ignored: daemon already running`

Cause: the named session is already active, so launch options (`--state`) are ignored.

Fix:

```bash
agent-browser --session dd-slack close || true
agent-browser --session dd-slack --state ~/.config/agent-browser/dd-slack-auth.json open "https://dd.slack.com/"
```

## `Browser not launched. Call launch first.`

Usually follows the `--state ignored` issue or a stale session.

Fix:

```bash
agent-browser --session dd-slack close || true
agent-browser --session dd-slack --state ~/.config/agent-browser/dd-slack-auth.json open "https://dd.slack.com/"
```

## Unsure which sessions are running

```bash
agent-browser session list
```

If you see `dd-slack` (or another Slack session name) and need fresh launch args, close that exact session first.

## Auth expired / redirected to login

Refresh auth state with headed login:

```bash
agent-browser --session dd-slack-auth close || true
agent-browser --headed --session dd-slack-auth open "https://dd.slack.com/"
# complete SSO/MFA
agent-browser --session dd-slack-auth state save ~/.config/agent-browser/dd-slack-auth.json
```

Then restart headless session with `--state`.

## Quick diagnostics

```bash
agent-browser --session dd-slack get title
agent-browser --session dd-slack get url
agent-browser --session dd-slack screenshot dd-slack-state.png
agent-browser --session dd-slack errors
agent-browser --session dd-slack console
```
