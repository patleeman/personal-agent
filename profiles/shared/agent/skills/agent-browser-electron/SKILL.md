---
name: agent-browser-electron
description: Automate Electron desktop apps (VS Code, Slack, Discord, Figma, Notion, Spotify, etc.) using agent-browser via Chrome DevTools Protocol. Use when the user needs to interact with a desktop Electron app, connect to a running app, test an Electron application, or automate native app workflows.
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*)
---

# Electron App Automation

Automate Electron desktop apps with `agent-browser` by connecting over CDP.

## Core workflow

1. Quit the app if already running
2. Launch with `--remote-debugging-port`
3. Connect with `agent-browser connect <port>`
4. Use normal snapshot → interact → re-snapshot loop

```bash
# Example: Slack desktop
open -a "Slack" --args --remote-debugging-port=9222
sleep 3
agent-browser connect 9222
agent-browser snapshot -i
agent-browser click @e5
agent-browser screenshot slack-desktop.png
```

## Launching Electron apps with CDP

### macOS

```bash
open -a "Slack" --args --remote-debugging-port=9222
open -a "Visual Studio Code" --args --remote-debugging-port=9223
open -a "Discord" --args --remote-debugging-port=9224
open -a "Figma" --args --remote-debugging-port=9225
open -a "Notion" --args --remote-debugging-port=9226
open -a "Spotify" --args --remote-debugging-port=9227
```

### Linux

```bash
slack --remote-debugging-port=9222
code --remote-debugging-port=9223
discord --remote-debugging-port=9224
```

### Windows

```bash
"C:\Users\%USERNAME%\AppData\Local\slack\slack.exe" --remote-debugging-port=9222
"C:\Users\%USERNAME%\AppData\Local\Programs\Microsoft VS Code\Code.exe" --remote-debugging-port=9223
```

Important: the app must be launched with the flag. If it is already open, quit and relaunch.

## Connecting

```bash
# Persistent connection for subsequent commands
agent-browser connect 9222

# Or one-off command connection
agent-browser --cdp 9222 snapshot -i
```

## Tab management

Electron apps may expose multiple targets/windows/webviews.

```bash
agent-browser tab
agent-browser tab 2
```

## Common patterns

### Inspect and navigate

```bash
agent-browser connect 9222
agent-browser snapshot -i
agent-browser click @e10
agent-browser snapshot -i
```

### Screenshots

```bash
agent-browser connect 9222
agent-browser screenshot app-state.png
agent-browser screenshot --full full-app.png
```

### Extract data

```bash
agent-browser connect 9222
agent-browser snapshot -i
agent-browser get text @e5
agent-browser snapshot --json > app-state.json
```

### Fill forms

```bash
agent-browser connect 9222
agent-browser snapshot -i
agent-browser fill @e3 "search query"
agent-browser press Enter
agent-browser wait 1000
agent-browser snapshot -i
```

### Multiple apps in parallel

```bash
agent-browser --session slack connect 9222
agent-browser --session vscode connect 9223

agent-browser --session slack snapshot -i
agent-browser --session vscode snapshot -i
```

## Troubleshooting

### "Connection refused" / cannot connect

- Verify launch used `--remote-debugging-port=<port>`
- Quit and relaunch app if it was already running
- Check port usage: `lsof -i :9222`

### Launch works but connect fails

- Wait a few seconds after launch: `sleep 3`
- Some apps initialize webviews slowly

### Missing elements in snapshot

- Switch targets with `agent-browser tab`
- Use `agent-browser snapshot -i -C`

### Dark mode rendering mismatch

When needed, set media emulation explicitly:

```bash
agent-browser set media dark
```

## Supported apps

Any Electron app can work, including:
- Communication: Slack, Discord, Teams, Signal
- Development: VS Code, GitHub Desktop, Postman
- Design/Productivity: Figma, Notion, Obsidian
- Media: Spotify
