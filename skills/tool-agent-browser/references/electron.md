# Electron App Automation (CDP)

Automate Electron desktop apps by launching them with a Chrome DevTools Protocol (CDP) port, then connecting with `agent-browser`.

**Native default:** start each workflow with `agent-browser --native <first-command>`, then run regular `agent-browser ...` commands for the rest of that session (or use the `ab` helper from [SKILL.md](../SKILL.md)).

## Core Workflow

1. Quit app if already running
2. Launch with `--remote-debugging-port=<port>`
3. Connect: `agent-browser connect <port>`
4. Use normal snapshot → interact → re-snapshot loop

```bash
# Example: Slack desktop on macOS
open -a "Slack" --args --remote-debugging-port=9222
sleep 3
agent-browser connect 9222
agent-browser snapshot -i -C
agent-browser click @e5
agent-browser screenshot slack-desktop.png
```

## Launching Electron Apps with CDP

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

Important: the app must be started with the debugging flag. If it is already open, quit and relaunch.

## Connecting

```bash
# Persistent session connection
agent-browser connect 9222

# One-off command using a CDP port
agent-browser --cdp 9222 snapshot -i
```

## Target/Tab Management

Electron may expose multiple targets (windows/webviews).

```bash
agent-browser tab
agent-browser tab 2
```

## Common Patterns

### Inspect and Navigate

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

### Extract Data

```bash
agent-browser connect 9222
agent-browser snapshot -i
agent-browser get text @e5
agent-browser snapshot --json > app-state.json
```

### Fill Forms

```bash
agent-browser connect 9222
agent-browser snapshot -i
agent-browser fill @e3 "search query"
agent-browser press Enter
agent-browser wait 1000
agent-browser snapshot -i
```

### Multiple Apps in Parallel

```bash
agent-browser --session slack connect 9222
agent-browser --session vscode connect 9223

agent-browser --session slack snapshot -i
agent-browser --session vscode snapshot -i
```

## Troubleshooting

### "Connection refused" / cannot connect

- Verify launch command used `--remote-debugging-port=<port>`
- Quit and relaunch app if it was already running
- Check port usage: `lsof -i :9222`

### Launch works but connect fails

- Wait for app startup: `sleep 3`
- Some apps initialize webviews slowly

### Missing elements in snapshot

- Switch targets with `agent-browser tab`
- Use cursor-interactive mode: `agent-browser snapshot -i -C`

### Dark mode rendering mismatch

```bash
agent-browser set media dark
```

## Commonly Supported Electron Apps

- Communication: Slack, Discord, Teams, Signal
- Development: VS Code, GitHub Desktop, Postman
- Design/productivity: Figma, Notion, Obsidian
- Media: Spotify
