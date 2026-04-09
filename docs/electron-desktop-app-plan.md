# Electron desktop app

> Historical filename note: this path used to hold the plan. The desktop shell now ships, and this page is the current product overview.

`personal-agent` includes an Electron desktop shell in `packages/desktop`.

The desktop app is a tray/menubar-style wrapper around the existing web UI. It owns a local backend while it is running and can also connect to saved remote hosts.

## What the desktop app does today

- ships as a normal macOS app with a branded app icon and an always-available menubar icon
- keeps a tray app alive after the main window closes
- opens the existing web UI in Electron windows
- owns a local daemon + web UI child-process pair for the local host
- supports saved **web** and **ssh** remote hosts
- lets you switch hosts or open a remote host in its own window
- stores machine-local desktop config and window state

## Daily use

From the repo root:

```bash
npm run desktop:start
```

Useful build commands:

```bash
npm run desktop:dev
npm run desktop:dist
```

Behavior to expect:

- closing the main window hides it instead of quitting the app
- the app keeps a standard application menu in the macOS menu bar alongside the menubar status item
- quitting from the tray or app menu shuts down the desktop-owned local backend
- the desktop shell uses the same web UI, not a separate native renderer

## Desktop shortcuts

When the UI is running inside Electron, the desktop shell adds a few conversation and window shortcuts:

- `Cmd/Ctrl+N` — new conversation
- `Cmd/Ctrl+W` — close the current conversation surface
- `Cmd/Ctrl+[` / `Cmd/Ctrl+]` — previous / next conversation
- `Cmd/Ctrl+1…9` — jump to conversation slots in sidebar order
- `Cmd/Ctrl+Alt+[` / `Cmd/Ctrl+Alt+]` — move the current conversation left / right inside its shelf
- `Cmd/Ctrl+Shift+W` — hide the current window
- `Cmd/Ctrl+,` — open desktop connections
- `Cmd/Ctrl+K` — open the command palette

That gives us distinct shortcuts for closing a conversation, moving around the conversation workspace, and hiding the actual Electron window.

## Host modes

### Local host

The local desktop host:

- starts its own daemon in foreground child-process mode
- starts its own web server on `http://127.0.0.1:3741`
- disables the companion surface for that desktop-owned local backend
- refuses to start if another daemon is already running or the web port is already occupied

### Web remote host

A web remote host is just a reachable personal-agent web UI base URL.

The desktop shell probes `/api/status` and then opens that remote UI directly.

### SSH remote host

An SSH remote host:

- opens an SSH tunnel to a local forwarded port
- probes the remote web UI through the tunnel
- can bootstrap the remote daemon and web UI if needed

## Machine-local desktop state

By default, the desktop shell stores state in:

```text
~/.local/state/personal-agent/desktop/
```

Important files:

- `config.json` — saved hosts, default host, window state
- `logs/` — desktop, daemon-child, and web-child logs

## Current limitations

- restart control is only implemented for the local host
- the desktop-owned local backend intentionally does not expose the companion surface
- the desktop shell does not reuse an already-running external local daemon/web UI pair

## Related docs

- [Electron desktop architecture](./electron-desktop-app-spec.md)
- [Web UI Guide](./web-ui.md)
- [Release cycle](./release-cycle.md)
