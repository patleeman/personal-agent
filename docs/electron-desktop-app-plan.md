# Electron desktop app

> Historical filename note: this path used to hold the plan. The desktop shell now ships, and this page is the current product overview.

`personal-agent` includes an Electron desktop shell in `packages/desktop`.

The desktop app is a tray/menubar-style wrapper around the existing web UI. It owns the local runtime while it is running and can also connect to saved remote hosts.

On macOS, the desktop shell is the intended local product surface. Background behavior comes from the menubar app staying alive, not from separate launchd-managed daemon or web UI services.

## What the desktop app does today

- ships as a macOS menu bar app with an always-available menubar icon, then promotes itself to a normal foreground app while any window is open
- keeps a tray app alive after the main window closes
- shows the 10 most recent conversations directly in the tray menu for quick reopen
- loads the packaged web UI inside Electron windows
- owns the local daemon for the local host and keeps core local API/event flows inside the Electron process
- supports saved **web** and **ssh** remote hosts
- lets you switch hosts or open a remote host in its own window
- stores machine-local desktop config, app behavior preferences, and window state

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

- on macOS, `npm run desktop:start` launches through a generated dev app bundle so the menu bar app name and About window use Personal Agent branding instead of the stock Electron shell metadata
- closing the main window hides it instead of quitting the app, so the menubar app keeps running
- showing or focusing a window promotes the app into normal macOS app mode, including the standard application menu and Dock presence
- File → New Window opens another desktop window for the current host and route
- clicking a normal external URL opens it in the system browser instead of spawning another Electron window
- hiding every window drops the app back to a menubar-only background mode
- the native macOS About panel shows the Personal Agent icon plus the current Personal Agent and pinned Pi versions
- quitting from the tray or app menu asks for confirmation, then shuts down the desktop-owned local backend; if an external daemon is already running outside the app, the quit dialog makes it clear the desktop app does not own or stop it
- the desktop shell uses the same web UI, not a separate native renderer
- if desktop startup fails before the packaged web UI comes up, Electron opens a dedicated startup-error page with the failure message and the desktop logs path
- if the renderer recovers from a route-level crash inside the normal shell, the fallback card shows the thrown error message under **Error details**

## Desktop shortcuts

When the UI is running inside Electron, the desktop shell adds a few conversation and window shortcuts:

- `Cmd/Ctrl+N` — new conversation
- `Cmd/Ctrl+W` — close the current conversation surface
- `Cmd/Ctrl+Shift+N` — reopen the most recently closed conversation
- `Cmd/Ctrl+[` / `Cmd/Ctrl+]` — previous / next conversation
- `Cmd/Ctrl+1…9` — jump to conversation slots in sidebar order
- `Cmd/Ctrl+Alt+[` / `Cmd/Ctrl+Alt+]` — move the current conversation left / right inside its shelf
- `Cmd/Ctrl+Alt+,` / `Cmd/Ctrl+Alt+.` — previous / next host
- `Cmd/Ctrl+Alt+P` — pin or unpin the current conversation
- `Cmd/Ctrl+Alt+A` — archive or restore the current conversation
- `Cmd/Ctrl+Alt+R` — rename the current conversation
- `Cmd/Ctrl+L` — focus the composer
- `Cmd/Ctrl+Shift+L` — edit the working directory
- `Cmd/Ctrl+\` — toggle the sidebar
- `Cmd/Ctrl+Shift+\` — toggle the right rail
- `Cmd/Ctrl+Shift+W` — hide the current window
- `Cmd/Ctrl+,` — open Settings
- `Cmd/Ctrl+K` — open the command palette

That gives us distinct shortcuts for closing a conversation, moving around the conversation workspace, switching hosts, managing conversation state, jumping back into typing, and hiding or reshaping the Electron window.

## Host modes

### Local host

The local desktop host:

- normally starts its own daemon in-process inside the Electron desktop runtime
- refuses to attach to an already-running external daemon, so quit semantics stay sane
- loads the packaged renderer over `personal-agent://app/`
- resolves local JSON API requests and event streams through the Electron main process instead of a loopback web child
- calls the desktop-owned daemon directly for hot local flows instead of bouncing those paths back through the local daemon socket
- keeps that local runtime warm for as long as the menubar app stays open
- configures the in-process daemon as the companion host for native clients, with the desktop UI acting as the primary frontend

### SSH remote host

Remote hosts are SSH-only.

An SSH remote host:

- stores only SSH connection details in desktop settings
- lets the desktop detect remote macOS/Linux platform details over SSH
- receives the matching Pi release binary and a transient helper binary on demand
- starts a detached per-conversation remote Pi RPC runtime that survives disconnects
- lets the desktop reconnect to that runtime later over SSH without requiring Personal Agent to be installed on the remote machine
- exposes real remote directory browsing for cwd selection before and after a conversation is linked remotely

## Machine-local desktop state

By default, the desktop shell stores state in:

```text
~/.local/state/personal-agent/desktop/
```

Important files:

- `config.json` — saved hosts, default host, window state, auto-install updates, and start-on-sign-in preferences
- `logs/` — desktop shell and daemon-child logs

## Runtime controls in the app

In the desktop shell, the local daemon and packaged renderer are treated as internal runtime components.

That means:

- the Settings page describes the local runtime instead of exposing launchd/systemd-style service controls
- Desktop → App behavior owns auto-install-on-idle updates and start-on-sign-in behavior for the local menu bar app
- quitting the app is the expected way to stop the local Mac runtime because the desktop shell owns the daemon directly
- if an external daemon is already running outside the app, quitting the desktop app does not stop that daemon; use `pa daemon stop`, `pa daemon restart`, or `pa daemon service uninstall` to manage it explicitly
- background behavior normally comes from the menubar app staying open, not from separately managed OS services

## Current limitations

- the companion API currently depends on the daemon-backed desktop runtime; the native iOS client now lives at `apps/ios/PersonalAgentCompanion`, but the runtime ownership still routes through the desktop-backed bridge
- direct remote hosts still rely on the SSH remote runtime path for execution rather than a full second desktop frontend
- the desktop shell refuses to reuse an already-running external local daemon, and quitting the app will not stop that external daemon
- the desktop shell still does not reuse a separately managed local web UI

## Related docs

- [Electron desktop architecture](./electron-desktop-app-spec.md)
- [iOS host-connected app design](./ios-host-app-plan.md)
- [Web UI Guide](./web-ui.md)
- [Release cycle](./release-cycle.md)
