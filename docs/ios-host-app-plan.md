# iOS host-connected app design

The iOS app should be a **surface that connects to a Personal Agent host**, not another place that runs Pi, owns sessions, or deploys SSH helpers.

That keeps the two remote problems separate:

- **host connection** — connect to the machine that owns sessions, attachments, alerts, automations, pairing, and live presence
- **execution target** — where a conversation actually runs tools and model turns

This split covers both target use cases:

- **work** — laptop is the host, and some conversations execute on remote compute over SSH
- **home handoff** — Mac mini is the host, and laptop + iPhone connect to that same host to share the same threads

## Product thesis

A conversation belongs to exactly **one host**.

That host may run the conversation:

- on itself
- or on a host-managed SSH execution target

The iOS app only talks to the **host**. It never talks to raw SSH compute directly.

## Goals

- make iPhone and iPad first-class surfaces for an existing host
- share the same sessions, live state, attachments, artifacts, alerts, and automations as the host
- support handoff between desktop, browser, and iOS on the same host
- preserve the current remote-workspace idea, but treat it as **execution routing owned by the host**
- support multiple saved hosts on the phone, with explicit switching between them

## Non-goals

- running Pi or Personal Agent locally on iOS
- deploying Pi or the SSH helper from iOS
- syncing sessions across multiple hosts
- making remote compute boxes look like full PA hosts
- replacing the current desktop SSH remote flow before the host model exists

## Terms

| Term | Meaning |
| --- | --- |
| **Host** | The machine that owns durable PA state: sessions, attachments, alerts, automations, auth, and presence |
| **Surface** | One client attached to a host: desktop window, browser tab, iPhone app |
| **Execution target** | Where a conversation runs: host-local or host-managed SSH remote |
| **Remote compute** | An SSH target used for tools/model execution, but not a separate session universe |
| **Host connection** | A saved iOS connection to one host |
| **Handoff** | Moving active control of a live conversation between surfaces on the same host |

## User model

### Work remote workspace

- the **laptop** is the PA host
- the laptop routes some threads to a **remote compute** workspace over SSH
- the iPhone connects to the **laptop host** if it should see those same threads
- the remote compute box is not discoverable as an independent thread library

### Home handoff

- the **Mac mini** is the PA host
- the Mac mini owns the session store and background state
- the laptop and iPhone both connect to the **Mac mini host**
- handoff works because both surfaces are looking at the same host-owned conversations

### Multiple hosts

An iPhone can save more than one host:

- Home Mac mini
- Work laptop
- another dev box later

Those are separate universes. Sessions are shared **within a host**, not across hosts.

## Core design rule

The product must not collapse these two ideas into one setting:

- **connect to host**
- **run on execution target**

If they stay separate, the model is understandable:

- pick a **host** when you want the same threads and state
- pick an **execution target** when you want a thread to run somewhere else

## Host requirements

A host must own these responsibilities:

- conversation/session storage
- attachment and artifact storage
- live-session presence and takeover
- alerts, reminders, deferred resumes, runs, and automations
- remote-access pairing and device auth
- execution-target definitions and per-thread routing
- API + live-update transport for connected surfaces

Initial host form factors:

- **managed web UI service** on macOS/Linux
- later, optionally, a **desktop companion mode** that exposes the same host runtime directly from the desktop app

Important current limitation:

- the packaged Electron desktop shell does **not** currently expose a companion/mobile surface over Tailnet HTTPS
- remote browser access today comes from the managed web UI service

That means the first iOS host-connected model should target the **managed host service**, not the packaged desktop runtime.

## Architecture

```text
[iPhone app] ─────┐
[iPad/browser] ───┼──── HTTPS + SSE ────> [PA host]
[desktop app] ────┘                         │
                                            ├── local execution
                                            └── SSH execution targets
```

The host is the authority.

Surfaces subscribe to host state, view the same conversations, and request control when needed. The host decides whether a conversation is running locally or on a remote execution target.

## API model

The iOS app should use the host's existing HTTP API shape wherever possible.

### Existing surfaces to reuse

- `GET /api/status` — handshake and basic host inspection
- `GET /api/events` — app-level SSE snapshots
- `GET /api/live-sessions/:id/events` — conversation SSE stream
- `POST /api/live-sessions/:id/prompt` — submit a prompt
- `POST /api/live-sessions/:id/takeover` — claim control
- conversation/session detail endpoints for bootstrap, titles, cwd, artifacts, attachments, and metadata

### Host capability handshake

We should add a small host capability payload, either by extending `GET /api/status` or adding a dedicated host descriptor endpoint.

The app needs to know at least:

- host label / profile / version
- whether remote access auth is required
- whether native bearer auth is supported
- whether execution-target switching is supported
- whether push notifications are configured
- a stable `hostInstanceId` so renamed URLs do not look like new hosts

## Authentication

The current remote browser flow already has the right pairing shape:

- short-lived pairing code
- long-lived revocable device session

That should become the native iOS auth model too.

### Pairing flow

1. user enters a host URL or scans a host QR code
2. app calls `GET /api/status`
3. app checks whether remote access is required
4. user enters a short-lived pairing code generated on the host
5. app exchanges it through `POST /api/remote-access/device-token`
6. app stores the returned bearer token in the iOS Keychain
7. future API and SSE calls use `Authorization: Bearer <token>`

### Required backend change

The auth gate currently centers on the `pa_web` cookie flow.

For a native app, the host must also accept:

- `Authorization: Bearer <token>`

using the same device-session records already created by the pairing flow.

### Device/session management

The host should keep showing paired devices in Settings so the operator can:

- see which phones/tablets are paired
- revoke a device
- rename the device label later if needed

## Surface identity and handoff

The host already has the beginnings of the right model:

- per-surface registration
- surface type
- controller surface
- explicit takeover

The iOS app should participate in that same model.

### Surface identity

The app should create:

- a stable **device id** stored in Keychain
- an ephemeral **surface id** for each active conversation view/session

That lets the host distinguish:

- “Patrick's iPhone” as a device
- “the currently open conversation screen” as the active surface

### Surface type

For the first pass, the app can behave like the current mobile surface model.

Longer-term, the host should understand a dedicated native surface type, for example:

- `mobile_native`

That lets presence and future capability decisions distinguish native app clients from browser clients without changing the control semantics.

### Handoff behavior

Desired behavior:

- multiple surfaces can watch the same conversation
- one surface is the current controller for live actions that require control
- iPhone can explicitly take over from desktop
- desktop can take control back later
- mirrored surfaces keep reading live output even when they are not the controller

The conversation UI should show:

- current controller device
- current execution target
- a clear **Take over here** action when needed

## Execution model

The iOS app does not manage SSH remotes directly.

Instead:

- the app reads execution-target state from the host
- the app asks the host to continue or prompt a conversation
- the host routes the request to local execution or a host-managed SSH target

### Required architectural move

This is the main structural requirement for covering both use cases.

Today, SSH remotes are primarily a **desktop-owned capability**. That is good enough for the desktop shell, but it is not enough for a host-connected iOS app.

To support the iOS host model cleanly, execution-target state needs to move from **desktop-only ownership** into **host ownership**.

That means:

- saved SSH execution targets belong to the host runtime, not just Electron settings
- per-conversation execution-target routing belongs to the host
- desktop becomes one surface that uses those host APIs, instead of the only place that can drive them

Without that move, the iOS app can connect to a host and share host-owned conversations, but it cannot fully participate in conversations whose execution routing only exists inside one desktop process.

## UI shape

The iOS app should be a focused host client, not a full copy of the desktop UI.

### V1 screens

- **Hosts**
  - saved hosts
  - add host
  - pair / repair auth
  - host health and last-connected state
- **Conversations**
  - recent/open/pinned threads
  - search
  - attention badges
- **Conversation detail**
  - transcript
  - composer
  - attachments/artifacts access
  - current execution target
  - controller / presence state
  - takeover action
- **Settings**
  - paired account/device info
  - host connection management
  - notification preferences when they exist

### V1 omissions

These can remain desktop- or web-first initially:

- SSH execution-target management UI
- full automation editing
- detailed provider/model admin
- broad repo/folder management flows
- checkpoint diff review parity with desktop

The phone should be excellent at:

- reading and continuing conversations
- handing control between surfaces
- monitoring active work
- resolving lightweight prompts or unblock requests

## Notifications and background behavior

V1 should not depend on background agent execution on the phone.

### V1

- foreground app uses HTTPS + SSE
- background app reconnects when reopened
- no requirement for full closed-app push delivery yet

### Later

Add APNs support from the host so conversation attention and alert-worthy automation results can wake the phone.

That requires:

- APNs device registration on the host
- host-side notification preferences
- mapping existing alert/reminder concepts onto push delivery

## Offline and reconnect model

The app should assume the host is sometimes unreachable.

Expected behavior:

- cached host list and recent conversation metadata remain visible
- conversation detail can show last known transcript snapshot when offline
- reconnect automatically when the app returns foreground and the host is reachable
- auth expiry or revocation should degrade into a repair-auth state, not silent failure

## Security model

Preferred connection modes:

- **Tailnet HTTPS** first
- trusted local-network HTTPS later if needed

Security rules:

- store bearer tokens only in the iOS Keychain
- treat device tokens as revocable host sessions
- keep device labels visible to the host operator
- never require SSH credentials on the phone for normal conversation use
- keep execution-target secrets and provider credentials on the host

## Relationship to the web UI

A WKWebView wrapper is acceptable as a bootstrap step, but it is not the target architecture.

Target architecture:

- native host list and auth
- native conversation list and conversation view
- native SSE / API client
- native takeover and presence UI

The important design point is not whether the first build is web-wrapped or native.

The important design point is that the app connects to a **host-owned session model**.

## Rollout plan

### Phase 0 — host prerequisites

- add bearer-token auth support for native clients
- add host capability handshake
- define native surface identity and surface type
- expose enough host metadata for saved-host UX

### Phase 1 — iOS host client MVP

- saved hosts
- pair to host
- conversations list
- conversation detail + live stream
- prompt submission
- takeover / presence UI
- read basic attachments and artifacts

### Phase 2 — shared execution-target model

- move SSH execution-target ownership into the host runtime
- let desktop and iOS use the same execution-target APIs
- show execution-target state in mobile conversation detail
- optionally allow lightweight execution-target switching from mobile

### Phase 3 — mobile attention and push

- host-managed APNs registration
- push delivery for alerts/reminders/conversation attention
- notification deep links into the owning conversation

## Concrete product rule

If the operator wants the same threads on phone and desktop, those devices must connect to the **same host**.

If the operator wants a thread to run on another machine, that is an **execution-target** decision owned by that host.

That is the model this iOS app should implement.

## Related docs

- [Web UI Guide](./web-ui.md)
- [Electron desktop app](./electron-desktop-app-plan.md)
- [Electron desktop app spec](./electron-desktop-app-spec.md)
- [How personal-agent works](./how-it-works.md)
- [Web server route modules](./web-server-routing.md)
