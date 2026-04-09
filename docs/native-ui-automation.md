# Native UI Automation

`personal-agent` can validate web UI changes with `agent-browser`, but native macOS apps need a different path.

This repo includes a local helper wrapper at:

```bash
./scripts/mac-ax
```

That wrapper runs the Swift-based `mac-ax` helper under `tools/mac-ax`.

Use `mac-ax` when you need to inspect or drive a native macOS app through the Accessibility system rather than through a browser DOM.

## When to use it

Use `mac-ax` for:

- SwiftUI or AppKit apps
- native macOS dialogs and sheets
- quick live smoke interaction while debugging a desktop UI change

Prefer other paths when possible:

- use `agent-browser` for web apps and Electron apps with CDP
- use XCUITest for repeatable native-app smoke coverage

## Required permissions

The helper needs:

- Accessibility permission
- Screen Recording permission for screenshots

If those permissions are missing, clicks, snapshots, or screenshots may fail.

## Core commands

```bash
./scripts/mac-ax list-apps
./scripts/mac-ax windows "Personal Agent"
./scripts/mac-ax snapshot "Personal Agent"
./scripts/mac-ax snapshot "Personal Agent" --json
./scripts/mac-ax click --app "Personal Agent" --label "Connect"
./scripts/mac-ax focus --app "Personal Agent" --identifier some-id
./scripts/mac-ax set-value --app "Personal Agent" --label "Search" "new value"
./scripts/mac-ax type --app "Personal Agent" "hello world"
./scripts/mac-ax press --app "Personal Agent" return
./scripts/mac-ax screenshot --app "Personal Agent" /tmp/personal-agent.png
```

## Practical flow

1. `list-apps` to find the app name
2. `snapshot <app>` to inspect the current accessibility tree
3. target controls by cached ref, label, or identifier
4. use `click`, `focus`, `set-value`, `type`, or `press`

## Related docs

- [Web UI Guide](./web-ui.md)
- [Electron desktop app](./electron-desktop-app-plan.md)
