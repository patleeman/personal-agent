# iOS companion app and daemon companion API design

This document defines the target design for an iOS companion app that connects to Personal Agent.

The key product reality is:

- the **desktop app is the only primary UI today**
- the current desktop `/api` surface is mostly an **internal renderer/runtime contract**
- the iOS app should **not** couple itself to that internal contract
- instead, we should define a **new external companion API** with its own versioned root

## Decision summary

These are the design decisions locked in for v1.

| Area | Decision |
| --- | --- |
| Primary UI today | Desktop app only |
| External client API | Brand new, separate root |
| Companion API owner | **Daemon** |
| Conversation authority | **Daemon owns conversations and live sessions** |
| Network exposure | **Daemon serves HTTP + WebSocket directly** |
| Main transport | **Single multiplexed WebSocket** |
| Auth | Pairing code -> long-lived bearer token |
| Host identity | Stable `hostInstanceId` + human label |
| iOS scope | Conversations core + **full attachment parity** |
| Conversation list shape | Mirror desktop open/pinned ordering closely |
| Creation/resume | Full creation + resume controls |
| Remote execution in v1 | Full support, including **changing execution target from iOS** |
| Pairing/device admin | Daemon owns APIs; desktop UI is the frontend |

## Implementation status

Current repo implementation:

- host-side companion API: implemented at `/companion/v1`
- desktop companion admin UI: implemented in desktop Settings, including automatic local-network enable + setup QR generation for reachable host addresses
- setup QR generation now also includes a Tailnet HTTPS option when the companion API is published through Tailscale Serve, but it prefers direct LAN addresses for the default QR and skips tunnel-interface IPv4s like `utun*`; desktop setup generation still best-effort publishes the `/companion` path automatically when Tailscale is available
- native iOS client: implemented at `apps/ios/PersonalAgentCompanion`

The shipping iOS client currently covers:

- host pairing + local host persistence
- a host-first shell: select one host, then work inside Chat / Automations / Settings for that host
- setup QR onboarding via desktop-generated QR codes, custom `pa-companion://` setup links, and in-app QR scanning
- conversation list mirroring pinned/open/archived ordering, plus native pin/archive/duplicate controls
- live conversation transcript + prompt composer
- prompt images + saved drawing attachment refs
- compact internal-work transcript shelves for thinking + tool calls, matching the desktop model more closely than plain message bubbles
- runtime-driven model catalogs and service-tier support instead of hardcoded mobile-only model lists
- execution-target switching, SSH target CRUD, local/remote cwd browsing, takeover, abort, rename, and per-thread model preferences
- queued steer/follow-up restore, parallel-job management, and live presence/control-state display
- native `ask_user_question` rendering and answer submission inside the conversation surface
- conversation artifact browsing plus commit-checkpoint browsing and checkpoint creation
- saved attachment browse/read/create/update flows for drawing attachments, including a native PencilKit-based drawing editor that exports Excalidraw-compatible source assets
- automation list/detail/create/edit/delete/run flows, including callback delivery controls for background-agent automations
- durable run detail/log/cancel flows, without a dedicated top-level Runs tab in the iOS shell
- paired-device admin plus setup generation from iOS

## Product thesis

A Personal Agent installation should have one **companion host runtime** per machine context.

For this design, that host runtime is the **daemon**.

That means the daemon becomes the authority for:

- conversation/session metadata
- live sessions and live control
- presence and takeover
- attachments and artifacts
- device pairing and revocation
- execution-target routing
- the external companion API used by iOS

The desktop app remains the main operator interface, but it becomes a **frontend to daemon-owned state** rather than the sole owner of foreground conversation state.

## Goals

- define a stable external API for remote companion clients
- make the iOS app a real peer surface for the same conversations the desktop app sees
- keep one authoritative conversation/runtime model per host
- support full conversation work from iOS, including:
  - opening and creating conversations
  - resuming them live
  - prompting and taking over
  - viewing and creating attachments/assets
  - using conversations that execute on SSH remotes
  - changing execution target from iOS
- mirror desktop open/pinned conversation ordering closely enough that the phone feels like the same product

## Non-goals

- reviving browser/mobile-web clients as a product surface
- exposing the current internal desktop renderer API as the public companion API
- making the iOS app deploy Pi/helper or manage raw SSH sessions itself
- multi-host session sync
- SSH remote CRUD from iOS in v1

## Terms

| Term | Meaning |
| --- | --- |
| **Canonical machine** | The machine the user wants to connect to for shared threads |
| **Companion host** | The externally reachable daemon-backed runtime that owns conversations and exposes the companion API |
| **Surface** | One UI attached to a host: desktop UI, iOS app, later other native clients |
| **Execution target** | Where a conversation executes: local or SSH remote |
| **Companion API** | The new external API used by iOS and future remote native clients |

## Current-state problem

Today, the desktop product works because the desktop runtime brokers a mix of:

- Electron IPC
- internal API-shaped requests
- desktop-owned SSH remote execution state

That is fine for one packaged UI, but it is not a stable external contract.

If we want iOS to be a real companion client, we need a brand new API surface with different constraints:

- remotely reachable
- versioned
- authenticated
- stable across client releases
- independent of renderer implementation details
- authoritative for live conversation ownership and routing

## Why the daemon owns this

The daemon is the right long-lived process to host the companion API if the goal is a real peer client model.

For v1, the daemon should own:

- conversation registry and conversation metadata
- live-session lifecycle
- conversation presence and control state
- attachment and artifact metadata
- execution-target state and routing
- pairing codes and paired-device registry
- host identity and capability advertisement
- the companion HTTP + WebSocket server

This is a deliberate change from the current split where the desktop app owns much of the foreground live-conversation behavior.

The design goal is to remove the distinction between:

- “desktop foreground conversation state”
- “headless durable background state”

and replace it with:

- **one daemon-owned runtime model**
- multiple frontends, with desktop being the first and iOS being the second

## High-level architecture

```text
[iOS app] ───────────────┐
[desktop UI frontend] ───┼──────> [daemon companion host]
                         │            │
                         │            ├── conversations + live sessions
                         │            ├── pairing + devices
                         │            ├── attachments + artifacts
                         │            ├── execution target routing
                         │            └── local + SSH execution
                         │
                         └──── HTTP + WebSocket companion API
```

The daemon becomes the shared backend.

The desktop app is still the main product UI, but its job shifts toward:

- presenting the primary UX
- hosting the embedded renderer
- surfacing native OS integrations
- acting as the admin frontend for companion features

It should not remain the sole owner of remote/client-visible live conversation state.

## API boundary

The companion API should use a completely separate root.

### Root

Use:

```text
/companion/v1
```

This keeps the external contract cleanly separated from the current internal `/api` surface.

The existing internal desktop API can continue to evolve independently.

## Transport model

### Main transport

Use a **single multiplexed WebSocket** as the primary authenticated runtime channel.

That socket is responsible for:

- client hello / session ready
- app-level subscriptions
- conversation subscriptions
- command invocation
- command responses
- server events
- presence updates
- execution-target updates

### HTTP surface

Even in a WebSocket-first model, HTTP is still needed for a few things:

- initial host hello/capabilities
- pairing code exchange
- desktop-admin pairing/device routes
- large binary attachment/asset upload and download

So the v1 shape is:

- **HTTP for bootstrapping/auth/admin/blob transfer**
- **WebSocket for realtime state + commands**

That is still WebSocket-first in the way that matters to the companion client.

## HTTP endpoints

### Public companion hello

```text
GET /companion/v1/hello
```

Returns:

- `hostInstanceId`
- host label
- app/daemon version
- protocol version
- auth requirements
- capability flags

This endpoint exists so the iOS client can:

- identify whether it is talking to the same host as before
- display a stable human label
- understand companion capabilities before opening the socket

### Pairing exchange

```text
POST /companion/v1/auth/pair
```

Input:

- pairing code
- device label

Returns:

- bearer token
- paired device record
- host identity payload

### Device/session admin

These are daemon-owned APIs, primarily surfaced through the desktop UI.

Examples:

```text
POST   /companion/v1/admin/pairing-codes
GET    /companion/v1/admin/devices
DELETE /companion/v1/admin/devices/:deviceId
PATCH  /companion/v1/admin/devices/:deviceId
```

The desktop UI should call these daemon APIs rather than owning pairing state itself.

### Attachment and asset transfer

Binary asset transfer should stay on HTTP.

Examples:

```text
GET    /companion/v1/conversations/:id/attachments
GET    /companion/v1/conversations/:id/attachments/:attachmentId
GET    /companion/v1/conversations/:id/attachments/:attachmentId/assets/:asset
POST   /companion/v1/conversations/:id/attachments
PATCH  /companion/v1/conversations/:id/attachments/:attachmentId
```

For create/update, use authenticated multipart upload with desktop-parity attachment fields.

That includes support for:

- structured attachments like Excalidraw
- source + preview assets
- revisions
- metadata such as title and note

## WebSocket endpoint

### Socket URL

```text
GET /companion/v1/socket
```

The client authenticates with the bearer token during the WebSocket handshake.

### Connection contract

After the socket opens, the server should emit a `ready` envelope containing:

- `hostInstanceId`
- host label
- protocol version
- server capabilities
- current authenticated device/session info

## WebSocket envelope

Use a simple multiplexed frame shape.

### Client -> server

```json
{
  "id": "msg-123",
  "type": "command",
  "name": "conversation.prompt",
  "payload": {
    "conversationId": "conv_123",
    "text": "continue this",
    "surfaceId": "ios-surface-1"
  }
}
```

or:

```json
{
  "id": "msg-124",
  "type": "subscribe",
  "topic": "conversation",
  "key": "conv_123"
}
```

### Server -> client

```json
{
  "id": "msg-123",
  "type": "response",
  "ok": true,
  "result": {
    "accepted": true
  }
}
```

or:

```json
{
  "type": "event",
  "topic": "conversation",
  "key": "conv_123",
  "event": {
    "type": "text_delta",
    "delta": "..."
  }
}
```

This keeps one socket sufficient for app state, conversation state, and commands.

## Companion API domains

## 1. Host domain

The companion host must expose:

- host identity
- capability flags
- current device/session identity
- connection health

Example capabilities:

- companion API version
- attachment parity supported
- execution-target switching supported
- pairing admin supported

## 2. Conversation list domain

The iOS conversation list should mirror the desktop app’s open/pinned ordering closely.

That means the daemon must own or at least persist the ordering model used by the desktop UI.

V1 list payload should include:

- pinned conversation ids in order
- open conversation ids in order
- enough conversation metadata to render those rows
- recent conversations for fallback/history

The companion list is not just “all sessions sorted by recency.”
It needs to feel like the same working set the desktop app presents.

## 3. Conversation bootstrap domain

The daemon should expose a single conversation bootstrap read for iOS.

That bootstrap should return the initial state needed to render a conversation screen:

- conversation metadata
- transcript blocks
- live status
- presence/controller state
- execution target summary
- attachment summaries

This should be a clean external companion payload, not a direct mirror of the current internal desktop bootstrap types.

## 4. Conversation stream domain

Once bootstrapped, the iOS client subscribes to the conversation topic on the main socket.

Event families include:

- transcript deltas
- snapshot resets when needed
- turn start/end
- live status changes
- title updates
- presence/controller updates
- execution target updates
- attachment updates
- error state

## 5. Conversation commands

The v1 command surface should cover full creation/resume controls and core live actions.

Required commands:

- `conversation.create`
- `conversation.resume`
- `conversation.prompt`
- `conversation.abort`
- `conversation.takeover`
- `conversation.rename`
- `conversation.change_execution_target`

Likely useful shortly after:

- `conversation.change_cwd`
- `conversation.set_model_preferences`

The important design point is that commands are **typed daemon-level operations**, not leaked internal route translations.

## 6. Execution target domain

Remote execution needs full support in v1.

That means an iOS client must be able to:

- open a conversation that already runs on an SSH target
- see live state for that conversation
- prompt it normally
- take over control
- change its execution target between local and an existing SSH target

V1 originally did **not** require SSH target CRUD from iOS, but the current implementation now exposes SSH target management from the iOS host settings surface as well.

So the daemon must own:

- execution target definitions
- per-conversation execution target mapping
- routing of live operations to the correct local or SSH runtime

Desktop remains the place to manage SSH targets themselves.

iOS only needs to read the target list and switch among existing targets.

## 7. Attachment domain

V1 needs full desktop attachment parity.

At minimum that means:

- list attachment metadata for a conversation
- fetch attachment details
- download preview/source assets
- create new attachments from iOS
- update existing attachments from iOS
- support image/file uploads
- support structured attachments such as Excalidraw
- preserve revisioned source/preview assets and metadata fields

This should not be cut down to image-only support.

The product expectation is that attached assets are part of the conversation model, and the iOS client should participate fully.

## Surface identity and takeover

The host should distinguish:

- device identity
- active surface identity

### Device identity

Stable per paired device, stored in daemon state.

### Surface identity

Ephemeral per active conversation view/session.

The daemon should model takeover at the surface level.

That enables:

- desktop watching while iOS takes control
- iOS watching while desktop takes control back
- explicit control handoff without treating surfaces as separate thread owners

Use explicit native surface types rather than legacy web-oriented names.

Suggested v1 surface types:

- `desktop_ui`
- `ios_native`

## Host identity

Each companion host needs:

- stable `hostInstanceId`
- human-readable host label

`hostInstanceId` must survive process restarts and ordinary upgrades.

This lets the iOS client distinguish:

- “same host, new network path”
- “different host entirely”

## Security model

### Auth

Use:

- short-lived pairing code
- long-lived revocable bearer token per paired device

The bearer token lives in the iOS Keychain.

### Revocation

The daemon stores paired devices and can revoke them individually.

The desktop UI is the admin frontend for:

- creating pairing codes
- showing paired devices
- revoking devices
- renaming devices

### Network

The daemon directly serves the companion HTTP + WebSocket API.

This design does not depend on a browser/mobile-web surface.

## Desktop role in this model

The desktop app remains the only primary interface for now.

But architecturally it becomes:

- the main operator UI
- the admin frontend for daemon-owned companion features
- the native shell for OS integrations

It should stop being the only authority for live conversation state if we want a correct peer-surface model.

## Rollout plan

### Phase 0 — daemon host foundations

- add stable `hostInstanceId`
- add daemon HTTP + WebSocket companion server
- add daemon-owned pairing/device registry
- add public `hello` endpoint
- add authenticated multiplexed socket

### Phase 1 — daemon-owned conversation authority

- move conversation/session authority into the daemon
- move live-session ownership into the daemon
- make desktop UI read/write that daemon-owned state
- define companion bootstrap/event/command schemas

### Phase 2 — execution-target authority

- move execution-target routing under daemon ownership
- support local + SSH execution through daemon-owned routing
- expose read + change-execution-target companion commands
- keep SSH target CRUD desktop-only

### Phase 3 — attachment parity

- move attachment APIs under the companion root
- support binary source/preview asset transfer over HTTP
- support create/update parity from iOS
- support structured attachments like Excalidraw

### Phase 4 — iOS companion client

- host list + pairing
- conversation list mirroring desktop ordering
- conversation bootstrap + live stream
- create/resume/prompt/takeover/abort
- attachment view/create/update parity
- execution-target switching

## Concrete product rule

If two devices should share the same threads, they connect to the same **daemon-backed companion host**.

If a thread should run on another machine, that is an **execution-target routing decision** made by that host.

That is the model this iOS companion design implements.

## Ready-for-implementation note

The major architectural bet in this design is explicit:

> the daemon becomes the authoritative conversation host, not just a background-task subsystem.

That is the right move if we want a clean external client API and real peer surfaces.

## Related docs

- [Daemon and Background Automation](./daemon.md)
- [Electron desktop app](./electron-desktop-app-plan.md)
- [Electron desktop app spec](./electron-desktop-app-spec.md)
- [How personal-agent works](./how-it-works.md)
