# Electron desktop architecture

> Historical filename note: this path used to hold the implementation spec. It now documents the current architecture.

This page describes how the shipped desktop shell works.

## Package layout

The desktop shell lives in `packages/desktop/src/`.

Important areas:

- `main.ts` — app bootstrap
- `tray.ts` — tray/menu controller
- `window.ts` — BrowserWindow lifecycle and host-aware windows
- `ipc.ts` / `preload.ts` — narrow desktop bridge exposed to the renderer
- `hosts/` — host controllers for local, web, and SSH hosts
- `backend/` — local child-process ownership and health checks
- `state/desktop-config.ts` — machine-local desktop config persistence
- `desktop-env.ts` — packaged/dev runtime path resolution

## Local host architecture

The local host controller uses `LocalBackendProcesses`.

That component:

1. checks that no external daemon is already running
2. checks that port `3741` is free
3. spawns the daemon as a child process in foreground mode
4. spawns the web server as a child process
5. waits for both health checks to pass

The child web server is started with:

- `PA_WEB_PORT=3741`
- `PA_WEB_DISABLE_COMPANION=1`
- `PERSONAL_AGENT_REPO_ROOT=<repoRoot>`

So the desktop-owned local backend is intentionally desktop-only.

## Remote host architecture

### Web hosts

`WebHostController` stores a base URL and only requires that `/api/status` be reachable.

### SSH hosts

`SshHostController`:

- allocates a free local forwarded port
- starts `ssh -N -L <port>:127.0.0.1:<remotePort> <target>`
- probes the remote web UI through the tunnel
- if needed, bootstraps the remote host with `pa daemon start` and `pa ui`

Current SSH defaults:

- remote repo root: `~/workingdir/personal-agent`
- remote web UI port: `3741`
- remote companion: disabled during bootstrap

## Windows and shell behavior

The renderer is still the normal web UI.

The desktop shell adds:

- a hidden-titlebar BrowserWindow
- a tray/menubar-driven lifecycle with a standard application menu
- separate browser partitions per host
- host-aware window titles
- optional dedicated remote windows

The main window hides on close unless the app is quitting.

## Desktop bridge

The preload bridge is intentionally narrow. It exposes actions such as:

- get desktop environment
- get saved connections
- switch host
- save/delete host
- open new conversation
- open a host in its own window
- show connections UI
- go back / forward
- restart the active host

Application data still flows over HTTP to the same web UI server.

## Runtime files

Default machine-local desktop paths:

```text
~/.local/state/personal-agent/desktop/
├── config.json
└── logs/
```

The packaged desktop app resolves repo-like resources from app resources instead of the dev checkout.

## Packaging

`electron-builder` packages the desktop app from `packages/desktop`, includes the branded macOS app icon, and bundles extra resources such as:

- `defaults/`
- `extensions/`
- `internal-skills/`
- `prompt-catalog/`

## Why this design stayed simple

The desktop shell is a host shell around the existing web product, not a second product surface.

That keeps:

- one application UI
- one HTTP/API model
- one set of server routes
- a narrow native bridge for desktop-only actions

## Related docs

- [Electron desktop app](./electron-desktop-app-plan.md)
- [Web UI Guide](./web-ui.md)
- [Web server route modules](./web-server-routing.md)
