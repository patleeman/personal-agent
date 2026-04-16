# Electron desktop app spec

## Goals

- Make the macOS desktop app the primary product surface.
- Keep desktop-only capabilities in the main/preload boundary when they need lower latency or tighter host integration.
- Keep the browser UI focused on conversations, automations, runs, tools, and durable knowledge.

## Packaging model

The desktop shell owns:

- native windowing and menus
- a macOS `hiddenInset` title bar so native traffic lights stay visible and consistent
- a custom top bar sized to visually align in-app navigation controls with the native macOS traffic lights
- the packaged renderer entrypoint
- the preload bridge for trusted local capabilities
- host switching and local/remote connection state
- desktop-specific integrations like file reveal/open and system notifications

The renderer remains the same React app used for the web UI, but in local desktop mode it can call direct preload-backed capabilities instead of going through loopback HTTP for hot paths.

## Desktop bridge

The preload bridge is intentionally narrow. The packaged `personal-agent://app` renderer receives it through a CommonJS preload script so the bridge remains available even though the rest of the desktop package uses ESM. It exposes actions such as:

- subscribe to desktop-owned app bootstrap and hot state events in local mode
- read local conversation bootstrap, live-session state, and session detail/block data without loopback HTTP
- create, resume, rename, and control local conversations/live sessions for hot flows such as prompt delivery, queue restore, compact/reload, fork/branch, summarize-fork, destroy, and abort
- read durable run lists/details/logs and cancel local runs without routing those hot paths through generic local API calls
- read and manage local scheduled tasks without routing those operator flows through generic local API calls
- read and manage local alerts and conversation attention without routing those operator flows through generic local API calls
- read and manage local settings/operator flows such as instruction-file selection, model/runtime preferences, vault/default-cwd state, model providers, and provider auth without routing those flows through generic local API calls

- get desktop environment
- get saved connections
- switch host
- save/delete host
- open new conversation
- open a host in its own window
- show connections UI
- go back / forward

## Local capability rule

Use desktop-local capabilities when at least one of these is true:

- the action is latency-sensitive in the active desktop UX
- it needs direct main/preload APIs
- it is conceptually a host capability rather than an ordinary remote API

Otherwise, prefer the shared server route/API surface.

## Remote mode

Remote desktop connections are workspace-scoped and use a Codex-compatible app-server protocol instead of the old `pa-app-server-v1` desktop bridge.

That means:

- Electron windows still render the packaged `personal-agent://app/` UI for remote workspaces
- remote `/api/*` requests and SSE-style streams are adapted in Electron main onto Codex app-server requests and notifications
- direct remote workspaces connect to a `ws://` / `wss://` Codex-compatible endpoint
- SSH remote workspaces tunnel a remote `pa codex app-server --listen ...` process
- the preload bridge remains the renderer boundary; the remote transport is now the Codex protocol, not a custom desktop-only websocket surface
- the Codex surface should implement both thread/turn methods and standalone `command/exec` so Litter and other clients can browse workspaces and run helper commands without falling back to custom APIs
- conversation execution targeting should be per-thread, not per-window: a local desktop conversation can continue in a linked remote host while the local UI stays on the normal conversation route
- linked remote-target conversations should keep their local thread metadata and also create a real remote thread id on the target host for execution and visibility there

## Hosted workspace server

The desktop shell can host this machine as a remote workspace through a managed local Codex-compatible server.

- Desktop settings own an enable/disable toggle for the managed workspace server
- Electron main spawns and monitors the bundled helper instead of requiring manual shell commands
- unexpected helper exits should auto-restart with bounded backoff while the desktop tray app remains alive
- the managed local endpoint is shown as an exact websocket URL, including the publish path (currently `/codex`)
- optional Tailnet publishing uses `tailscale serve --set-path=/codex` and surfaces the exact `wss://.../codex` URL to copy into direct websocket remotes
- this hosting path is machine-local desktop state, separate from saved remote workspace connection records

## Litter compatibility

The desktop app owns installation of the local Litter SSH shim at `~/.litter/bin/codex`.

- the shim delegates `codex app-server ...` to the same bundled desktop helper path used by the managed workspace server
- the same server implementation also backs direct websocket remotes and SSH-bootstrapped remote workspaces
- local Litter connectivity should not require replacing the system `codex` binary globally

## UI shape

The renderer should still feel like one product across local desktop and remote browser use. Desktop-only capabilities should improve responsiveness and host integration, not fork the information architecture.

Desktop window restoration should be resilient to monitor changes. If the saved bounds are now off-screen or larger than the active display work area, Electron should clamp them back onto a visible display before showing the window.

## Related docs

- [Web UI Guide](./web-ui.md)
- [Web server route modules](./web-server-routing.md)
- [Daemon and Background Automation](./daemon.md)
