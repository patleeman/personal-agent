# Alleycat Remote Host

Personal Agent-owned remote host for Kitty Litter / Alleycat-compatible clients.

## Intent

This extension should replace external `kittylitter` process management for Personal Agent users:

- run a PA-managed Alleycat-compatible host
- advertise **only** `personal-agent`
- show pairing payload / QR in Settings
- expose Personal Agent conversations through the Codex-shaped JSON-RPC API Kitty expects

## Setup / QA

The same setup instructions are shown in the extension settings panel so users do not need to read this file.

Do **not** install or run `npx kittylitter` for Personal Agent pairing. That starts the upstream Kitty Litter host and advertises its built-in agents.

Use the PA extension instead:

1. Build/reload the experimental `system-alleycat` extension.
2. Enable it in Personal Agent; the companion host starts automatically while the extension is enabled.
3. Open Personal Agent Settings → **Kitty Litter Mobile Pairing**, or the Kitty Litter page.
4. In Kitty Litter, scan the QR code shown by Personal Agent.
5. Select **Personal Agent**. It should be the only advertised agent.

For cwd QA:

- Existing PA conversations should show their real desktop cwd in `thread/list`.
- Starting a thread with an explicit cwd should create the PA conversation in that cwd.
- If Kitty sends its local default `/root`, PA maps that to the desktop default repo/root cwd instead of creating useless `/root` sessions.
- File/cwd picker calls can use the fuzzy file search bridge; pass desktop roots such as `/Users/patrick/workingdir`.

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

Compatibility notes:

- `model/list` maps PA model metadata into Codex fields, including reasoning-effort fields when PA metadata provides them. Do not advertise fake reasoning values.
- Tool calls are emitted as Codex `dynamicToolCall` items under the `personal-agent` namespace so Kitty can render them instead of seeing opaque PA events.
- If Kitty adds stricter Codex rendering assumptions, update the protocol mapper here rather than changing PA conversation internals.

## Transport

`sidecar/` contains the Rust host process. The backend launches the packaged `bin/pa-alleycat-host-<platform>-<arch>` through `ctx.shell`, passes it the PA token/secret and local JSONL port, then reads the sidecar ready event for the real iroh pair payload.

The sidecar implements Alleycat host ops:

- `list_agents` returns only `personal-agent`
- `restart_agent` is accepted only for `personal-agent`
- `connect` returns a session ack, then byte-proxies the iroh stream to the local PA JSONL bridge

Do not reintroduce ACP or hijack a named external agent slot such as Devin.
