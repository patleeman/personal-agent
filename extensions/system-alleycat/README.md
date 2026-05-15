# Alleycat Remote Host

Personal Agent-owned remote host for Kitty Litter / Alleycat-compatible clients.

## Intent

This extension should replace external `kittylitter` process management for Personal Agent users:

- run a PA-managed Alleycat-compatible host
- advertise **only** `personal-agent`
- show pairing payload / QR in Settings
- expose Personal Agent conversations through the Codex-shaped JSON-RPC API Kitty expects

## Current implementation state

The extension runs a PA-owned Rust iroh sidecar and forwards `connect` streams to a local JSONL Personal Agent bridge. It reuses the protocol implementation from `system-codex`:

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

## Transport

`sidecar/` contains the Rust host process. The backend launches the packaged `bin/pa-alleycat-host-<platform>-<arch>` through `ctx.shell`, passes it the PA token/secret and local JSONL port, then reads the sidecar ready event for the real iroh pair payload.

The sidecar implements Alleycat host ops:

- `list_agents` returns only `personal-agent`
- `restart_agent` is accepted only for `personal-agent`
- `connect` returns a session ack, then byte-proxies the iroh stream to the local PA JSONL bridge

Do not reintroduce ACP or hijack a named external agent slot such as Devin.
