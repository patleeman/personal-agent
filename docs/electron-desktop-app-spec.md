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
- desktop-specific integrations like file reveal/open, system notifications, login-item start-on-sign-in control, and updater behavior

The renderer remains the same React app used for the web UI, but in local desktop mode it can call direct preload-backed capabilities instead of going through loopback HTTP for hot paths.

## Desktop bridge

The preload bridge is intentionally narrow. The packaged `personal-agent://app` renderer receives it through a CommonJS preload script so the bridge remains available even though the rest of the desktop package uses ESM. It exposes actions such as:

- subscribe to desktop-owned app bootstrap and hot state events in local mode
- read local conversation bootstrap, live-session state, and session detail/block data without loopback HTTP
- create, resume, rename, and control local conversations/live sessions for hot flows such as prompt delivery, queue restore, compact/reload, fork/branch, summarize-fork, destroy, and abort
- read durable run lists/details/logs and cancel local runs without routing those hot paths through generic local API calls
- read and manage local scheduled tasks without routing those operator flows through generic local API calls
- read and manage local alerts and conversation attention without routing those operator flows through generic local API calls
- read and manage local settings/operator flows such as instruction-file selection, model/runtime preferences, vault/default-cwd state, model providers, provider auth, and desktop app behavior preferences without routing those flows through generic local API calls

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

Remote desktop connections are SSH-only and run plain Pi on the remote machine.

That means:

- Electron always keeps rendering the local packaged `personal-agent://app/` UI
- saved remotes contain only SSH connection details; there is no direct websocket remote mode
- when a conversation targets a remote, the desktop app downloads the matching Pi release binary locally and copies it to the remote cache on demand
- the desktop app also copies a small transient helper binary that keeps a detached remote Pi RPC session alive across disconnects and lets the desktop reattach later
- remote cwd browsing is real remote browsing, not a local folder picker with a remote label
- conversation execution targeting remains per-thread, not per-window: a local desktop conversation can continue on an SSH remote while the local UI stays on the normal conversation route
- linked remote-target conversations keep their local thread metadata while the live execution state runs through remote Pi RPC over SSH

There is no hosted desktop remote server, no Tailnet remote transport, and no Codex app-server dependency in the desktop remote model anymore.

## UI shape

The renderer should still feel like one product across local desktop and remote browser use. Desktop-only capabilities should improve responsiveness and host integration, not fork the information architecture.

Desktop window restoration should be resilient to monitor changes. If the saved bounds are now off-screen or larger than the active display work area, Electron should clamp them back onto a visible display before showing the window.

## Related docs

- [Web UI Guide](./web-ui.md)
- [Web server route modules](./web-server-routing.md)
- [Daemon and Background Automation](./daemon.md)
