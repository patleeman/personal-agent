# Slack task workflows

Use these command patterns inside the Slack subagent.

## Standard startup (recommended)

```bash
agent-browser --session dd-slack close || true
agent-browser --session dd-slack --state ~/.config/agent-browser/dd-slack-auth.json open "https://dd.slack.com/"
agent-browser --session dd-slack snapshot -i -C
```

## Optional: connect to an existing Chrome Slack tab

Use this only when the user already has Slack open in a CDP-enabled browser.

```bash
agent-browser connect 9222
agent-browser snapshot -i -C
```

## Open a specific destination

```bash
# Channel
agent-browser --session dd-slack open "https://dd.slack.com/archives/<CHANNEL_ID>"

# DM
agent-browser --session dd-slack open "https://dd.slack.com/archives/<DM_ID>"

# Message permalink
agent-browser --session dd-slack open "https://dd.slack.com/archives/<CHANNEL_ID>/p<MESSAGE_TS>"
```

## Check unreads

```bash
agent-browser --session dd-slack snapshot -i -C
# Click Activity/Unreads related element from snapshot refs
agent-browser --session dd-slack click @eN
agent-browser --session dd-slack wait 1000
agent-browser --session dd-slack screenshot slack-unreads.png
```

## Search for a message/topic

```bash
agent-browser --session dd-slack snapshot -i -C
# Click search input/button from snapshot refs
agent-browser --session dd-slack click @eN
agent-browser --session dd-slack fill @eM "<query>"
agent-browser --session dd-slack press Enter
agent-browser --session dd-slack wait --load networkidle
agent-browser --session dd-slack screenshot slack-search.png
```

## Collect current page state

```bash
agent-browser --session dd-slack get title
agent-browser --session dd-slack get url
agent-browser --session dd-slack snapshot -i -C
```

## Message sending safety

- Draft only unless user explicitly confirms send.
- Ask for confirmation immediately before Enter/click Send.
