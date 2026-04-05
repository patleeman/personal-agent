# Native UI Automation

`personal-agent` can validate web UI changes with `agent-browser`, but native macOS apps need a different path.

This repo now includes a local helper wrapper at:

```bash
./scripts/mac-ax
```

That wrapper runs the Swift-based `mac-ax` helper under `tools/mac-ax`.

Use `mac-ax` when you need to inspect or drive a native macOS app through the Accessibility system rather than a browser DOM.

## When to use it

Use `mac-ax` for:

- SwiftUI/AppKit apps such as Pidex / `pi-native`
- native macOS dialogs and sheets
- quick live smoke interaction while debugging a UI change

Prefer other paths when possible:

- use `agent-browser` for web apps and Electron apps with CDP
- use XCUITest for repeatable smoke coverage of our own native app

## Required permissions

The helper needs:

- Accessibility permission
- Screen Recording permission for screenshots

If those permissions are missing, clicks, snapshots, or screenshots may fail.

## Core commands

From the repo root:

```bash
./scripts/mac-ax list-apps
./scripts/mac-ax windows "Pidex"
./scripts/mac-ax snapshot "Pidex"
./scripts/mac-ax snapshot "Pidex" --json
./scripts/mac-ax click --app "Pidex" --label "Settings"
./scripts/mac-ax focus --app "Pidex" --identifier composer.input
./scripts/mac-ax set-value --app "Pidex" --identifier composer.input "hello"
./scripts/mac-ax type --app "Pidex" "hello"
./scripts/mac-ax press --app "Pidex" Enter
./scripts/mac-ax screenshot --app "Pidex" /tmp/pidex.png
```

## Snapshot lifecycle

`mac-ax snapshot` writes a cache file under `~/Library/Caches/personal-agent/mac-ax/` so later `--id e12` interactions can resolve against the last captured UI tree.

That means refs are only valid until the UI changes materially. Re-run `snapshot` after navigation, dialog presentation, or layout changes.

## Recommended workflow

1. Launch or focus the target app.
2. Run `./scripts/mac-ax snapshot "App Name"`.
3. Interact with `--id`, `--label`, or `--identifier`.
4. Re-snapshot after UI changes.
5. Capture a screenshot when the visual result matters.

## For `pi-native`

For `pi-native` / Pidex:

- use `mac-ax` for ad-hoc local interaction and screenshots
- use XCUITest for repeatable end-to-end verification
- add accessibility identifiers on important controls to keep both paths reliable

## Related resources

- skill: `~/Documents/personal-agent/_skills/mac-ax/SKILL.md`
- implementation: `tools/mac-ax`
- wrapper: `scripts/mac-ax`
