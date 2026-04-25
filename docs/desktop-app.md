# Desktop App

The Electron desktop app is the only supported Personal Agent operator UI.

It serves the React renderer through Electron's `personal-agent://app/` protocol instead of a loopback web server.

## Start locally

```bash
npm run desktop:dev
```

For packaged builds, launch `Personal Agent.app`.

## Runtime model

- Electron owns the local UI surface through `personal-agent://app/`.
- The daemon still owns durable background behavior: runs, automations, wakeups, reminders, and companion pairing.
- The companion API still exposes HTTP/WebSocket on its configured port because phones and Tailnet clients need a public endpoint.

## Layout modes

The desktop top bar has a layout selector:

- **Compact** keeps the classic left sidebar plus one main content pane.
- **Workbench** applies to conversation routes and adds resizable panes for the transcript, the open Knowledge note, and the Knowledge file explorer/open-files rail.

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
