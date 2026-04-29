# Desktop App

The Electron desktop app is the only supported Personal Agent operator UI.

It serves the React renderer through Electron's `personal-agent://app/` protocol instead of a loopback web server.

## Start locally

```bash
npm run desktop:start
```

`desktop:start` and `desktop:dev` currently both build the Electron shell and launch it through `packages/desktop/scripts/launch-dev-app.mjs`:

```bash
npm run desktop:dev
```

For packaged builds, launch `Personal Agent.app`.

## Runtime model

- Electron owns the local UI surface through `personal-agent://app/`.
- The renderer routes are `/conversations`, `/conversations/new`, `/conversations/:id`, `/knowledge`, `/automations`, `/automations/:id`, and `/settings`.
- The daemon still owns durable background behavior: runs, automations, wakeups, reminders, and companion pairing.
- The companion API still exposes HTTP/WebSocket on its configured port because phones and Tailnet clients need a public endpoint.
- The desktop app consumes server-pushed app events for sessions, runs, tasks, daemon status, and invalidation; API snapshots are the fallback when the event stream is not available.

## Layout modes

The desktop top bar has a layout selector:

- **Compact** keeps the classic left sidebar plus one main content pane.
- **Workbench** applies to conversation routes and adds resizable panes for the transcript, the open Knowledge note, and the Knowledge file explorer/open-files rail.

Use `Cmd+Option+\` on macOS, or `Ctrl+Alt+\` elsewhere, to toggle between Compact and Workbench. It sits with the related layout shortcuts: `Cmd/Ctrl+\` toggles the left sidebar and `Cmd/Ctrl+Shift+\` toggles the right rail.

The right-side workbench rail includes Knowledge, File Explorer, Artifacts when present, and Browser. Browser is an Electron-owned embedded web view with local navigation controls plus agent-facing tools: capture a readable snapshot, or run a small JSON action batch (`click`, `type`, `key`, `scroll`, `wait`) and capture the resulting snapshot. Right-click inside the browser and choose “Comment on this” to attach a targeted browser comment to the composer; it is sent as prompt context with selector, role/name, text, nearby text, and viewport metadata.

Workbench stores its mode and pane widths in browser-local layout preferences. Reset them from Settings → Browser local state → “Reset layout + reload”.

## Validation

For desktop UI work, run the desktop app and validate with agent-browser through the repo wrapper:

```bash
npm run ab:run -- --session desktop-check --command "ab open personal-agent://app/ && ab wait 1000 && ab snapshot -i"
```

## Related docs

- [Daemon](./daemon.md)
- [Command-Line Guide](./command-line.md)
- [Agent Browser](./agent-browser.md)
- [iOS Companion](./ios-companion.md)
