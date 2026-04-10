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
2. spawns the daemon as a child process in foreground mode
3. marks the process environment as desktop-owned runtime
4. keeps the local daemon warm for the menubar shell

The renderer itself is loaded from packaged assets over `personal-agent://app/`.

Local JSON API requests and stream subscriptions are resolved inside Electron through:

- the desktop protocol handler for `/api/...` resource and mutation requests
- the main-process host controller bridge for local capability calls
- an in-process local API dispatcher that reuses shared server route logic where practical and, in packaged builds, loads its `localApi.js` entrypoint from the bundled `@personal-agent/web/dist-server` package path

So the desktop-owned local backend is intentionally desktop-only and no longer depends on a loopback web child for core local flows.

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
- a tray/menubar-driven lifecycle that runs as a macOS accessory/menu bar app without a dock icon
- a standard application menu while desktop windows are focused
- separate browser partitions per host
- host-aware window titles
- optional dedicated remote windows

The main window hides on close unless the app is quitting.

## Desktop bridge

The preload bridge is intentionally narrow. The packaged `personal-agent://app` renderer receives it through a CommonJS preload script so the bridge remains available even though the rest of the desktop package uses ESM. It exposes actions such as:

- subscribe to desktop-owned app bootstrap and hot state events in local mode
- read local conversation bootstrap, live-session state, and session detail/block data without loopback HTTP
- create, resume, rename, and control local conversations/live sessions for hot flows such as prompt delivery, queue restore, compact/reload, fork/branch, summarize-fork, destroy, and abort
- read durable run lists/details/logs and cancel local runs without routing those hot paths through generic local API calls

- get desktop environment
- get saved connections
- switch host
- save/delete host
- open new conversation
- open a host in its own window
- show connections UI
- go back / forward
- restart the active host

In local Electron mode, hot app data no longer depends on same-origin loopback HTTP. App bootstrap and hot app-state updates now use a dedicated desktop bridge capability, while the remaining stream-heavy surfaces continue to resolve through the Electron main process. Remote hosts still use their HTTP or SSH-backed adapters.

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
- one shared set of route/service modules
- one host boundary for local and remote adapters
- a narrow native bridge where desktop-specific capabilities need it

## Related docs

- [Electron desktop app](./electron-desktop-app-plan.md)
- [Web UI Guide](./web-ui.md)
- [Web server route modules](./web-server-routing.md)
