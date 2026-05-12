# Codex Protocol

The Codex Protocol extension exposes Personal Agent conversations through the Codex app-server WebSocket protocol for mobile clients like KittyLitter.

## Connection

The server listens on the configured Codex port, bound to `0.0.0.0` so LAN and Tailnet clients can reach it.

- URL: `ws://<host-or-tailnet-ip>:<port>/`
- Path: `/`
- Health check: `http://<host-or-tailnet-ip>:<port>/` returns `OK`

KittyLitter's direct WebSocket flow may not send the PA pairing token, especially over plain `ws://` non-loopback URLs. The server therefore keeps the token for PA-owned pairing surfaces but accepts unauthenticated direct Codex-compatible WebSocket clients unless they provide an invalid bearer token.

## Compatibility notes

The wire shape follows upstream Codex app-server responses where mobile clients deserialize strictly:

- `initialize` returns `userAgent`, `codexHome`, `platformFamily`, and `platformOs`.
- `thread/list`, `thread/start`, `thread/resume`, `thread/read`, and `model/list` return upstream-style camelCase payloads.
- `account/read` reports an API-key-style account because PA handles model credentials outside the Codex client, and KittyLitter treats a connected remote with no account as sign-in-required.
