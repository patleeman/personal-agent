# Desktop App

The Electron desktop app is the only supported Personal Agent operator UI.

It serves the React renderer through Electron's `personal-agent://app/` protocol instead of a loopback web server. There is no standalone browser UI on port `3741` anymore.

## Start locally

```bash
npm run desktop:dev
```

For packaged builds, launch `Personal Agent.app`.

## Runtime model

- Electron owns the local UI surface through `personal-agent://app/`.
- The daemon still owns durable background behavior: runs, automations, wakeups, reminders, and companion pairing.
- The companion API still exposes HTTP/WebSocket on its configured port because phones and Tailnet clients need a public endpoint.
- The old `pa ui` / managed web UI service path is removed.

## Validation

For desktop UI work, run the desktop app and validate with agent-browser through the repo wrapper:

```bash
npm run ab:run -- --session desktop-check --command "ab open personal-agent://app/ && ab wait 1000 && ab snapshot -i"
```

## Related docs

- [Daemon](./daemon.md)
- [Command-Line Guide](./command-line.md)
- [Agent Browser](./agent-browser.md)
