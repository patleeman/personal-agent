# Alleycat Remote Host

Personal Agent-owned remote host for Kitty Litter / Alleycat-compatible clients.

## Intent

This extension should replace external `kittylitter` process management for Personal Agent users:

- run a PA-managed Alleycat-compatible host
- advertise **only** `personal-agent`
- show pairing payload / QR in Settings
- expose Personal Agent conversations through the Codex-shaped JSON-RPC API Kitty expects

## Current implementation state

The extension currently wires the full Personal Agent Codex-shaped JSON-RPC handler set behind a local compatibility listener. It reuses the protocol implementation from `system-codex`:

- `initialize`
- `thread/list`
- `thread/start`
- `thread/read`
- `thread/resume`
- `thread/fork`
- `thread/archive` / `thread/unarchive`
- `thread/name/set`
- `thread/metadata/update`
- `thread/compact/start`
- `thread/rollback`
- `thread/inject_items`
- `thread/unsubscribe`
- `thread/shellCommand`
- `thread/goal/*`
- `turn/start`
- `turn/steer`
- `turn/interrupt`
- `model/list`
- `account/read`
- `config/read`
- `configRequirements/read`
- `skills/list`
- filesystem / command / process compatibility handlers and stubs used by Codex clients

## Remaining work

The local compatibility listener is not the final phone-pairing transport. The remaining bridge layer is a bundled Rust sidecar or native host component that owns:

- iroh endpoint
- Alleycat pair payload with real iroh node id
- `list_agents` returning only `personal-agent`
- `connect` stream handoff to the Codex-shaped JSON-RPC handler

Do not reintroduce ACP or hijack a named external agent slot such as Devin.
