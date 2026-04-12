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
- read and manage local settings/operator flows such as profiles, model/runtime preferences, vault/default-cwd state, model providers, and provider auth without routing those flows through generic local API calls

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

Remote hosts still use the web/server API surface, but the transport is now an app-server WebSocket owned by Electron main instead of loading a remote browser origin directly.

That means:

- Electron windows still render the packaged `personal-agent://app/` UI for remote hosts
- remote `/api/*` requests and SSE-style streams are forwarded through the main process over app-server
- direct web remotes authenticate app-server with a stored bearer token minted from a one-time pairing-code exchange
- the preload bridge remains the renderer boundary; app-server replaces the old remote transport, not desktop IPC

## UI shape

The renderer should still feel like one product across local desktop and remote browser use. Desktop-only capabilities should improve responsiveness and host integration, not fork the information architecture.

## Related docs

- [Web UI Guide](./web-ui.md)
- [Web server route modules](./web-server-routing.md)
- [Daemon and Background Automation](./daemon.md)
