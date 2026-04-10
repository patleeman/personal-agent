# Desktop Migration Plan

This repo is moving to a desktop-first architecture.

The target product is the macOS Electron app. Local mode should feel like one fast desktop application, with the menu bar app owning background behavior. The current local web-server shape is treated as legacy scaffolding, not the long-term product architecture.

## Product decisions

- The Electron app is the primary product surface.
- Local desktop mode will stop depending on a loopback web UI server.
- launchd/systemd concepts are removed from the local product model.
- The companion app is out of scope.
- The current web app only matters as a future remote-host adapter, not as the local architecture.
- Remote connections remain a future requirement, so we keep a host boundary and design for a later remote transport.

## Target end state

### Local desktop

- Packaged renderer assets load directly inside Electron.
- The main process owns local runtime services:
  - conversations
  - live sessions
  - runs and tasks
  - alerts, reminders, and wakeups
  - artifacts and attachments
  - file access and workspace state
  - model/provider state used by the desktop UI
- The renderer talks to the main process over typed IPC/RPC.
- Live updates use IPC subscriptions or pushed events instead of local SSE.
- The menu bar app keeps the runtime warm in the background.

### Remote hosts

- Remote support remains possible, but only through a host adapter boundary.
- The renderer should talk to a host capability layer, not to raw HTTP endpoints.
- Local host uses direct IPC.
- Future remote hosts can use HTTP/WebSocket/SSH behind the same capability interfaces.

## Non-goals

- Preserve the current local web-server architecture as a first-class product.
- Preserve companion-specific paths.
- Migrate endpoint-by-endpoint without reshaping ownership.
- Keep launchd/systemd setup flows as part of the local Mac experience.

## Migration strategy

The migration is capability-first, not endpoint-first.

We will move the renderer onto desktop-owned capabilities one slice at a time. Each slice should:

1. move a real user-facing capability off direct local HTTP
2. work in local Electron mode
3. keep browser/remote paths working where still needed
4. be manually tested in the app
5. leave the codebase closer to removing the local web server entirely

## Capability migration order

### Phase 0 — Ground rules and visibility

- [x] Treat desktop runtime as app-owned in runtime UI and diagnostics.
- [ ] Keep a single source-of-truth migration plan in the repo root.
- [ ] Track every migrated capability here with status and validation notes.
- [ ] Keep desktop perf measurements for conversation open, send, and app startup.

### Phase 1 — Introduce the desktop capability boundary

Goal: the renderer stops assuming that local data always comes from same-origin fetch.

- [x] Add typed desktop bridge methods for product capabilities.
- [x] Add a desktop host capability layer in the main process.
- [x] Route hot local capabilities through Electron IPC.
- [x] Keep browser mode and future remote mode working through fallback adapters.

Completed in this phase:

- [x] local desktop JSON API requests from `api.ts` now go through the Electron main process
- [x] safe file-backed local endpoints have an in-process route dispatcher fast path in the main process
- [x] remaining local desktop JSON endpoints are proxied through the active host controller instead of renderer-side fetch
- [x] local desktop EventSource consumers now go through a main-process stream bridge for app events, live-session events, run events, and provider OAuth progress events

Initial capabilities to migrate:

- [x] conversation bootstrap
- [ ] live session creation
- [ ] live session prompt send / abort / queue control
- [ ] session detail windowing and block hydrate
- [ ] conversation event stream / invalidation stream

### Phase 2 — Move conversation flow off the local web server

Goal: opening and using a conversation in local desktop mode should not depend on local HTTP.

- [ ] Create local desktop conversation services in the main process.
- [x] Reuse shared Node-side conversation logic without going through Express where practical.
- [x] Replace local SSE conversation updates with IPC push/subscription flows.
- [ ] Move conversation open, transcript updates, send, abort, rename, cwd change, fork, and branch to IPC-backed capabilities.
- [x] Keep prewarming and transcript caches in the desktop-owned runtime.

Success bar:

- [ ] opening an existing conversation is IPC-only in local desktop mode
- [ ] starting a new conversation is IPC-only in local desktop mode
- [ ] sending and streaming replies are IPC-only in local desktop mode

### Phase 3 — Migrate desktop runtime state and background features

Goal: the menu bar app and main process own local background behavior.

- [ ] runs list/detail/logs/events
- [ ] tasks list/detail/run/edit
- [ ] alerts/activity/inbox state
- [ ] reminders/deferred resumes/wakeups
- [ ] system/runtime status used by the desktop UI
- [ ] provider auth and model preferences needed in the app

Success bar:

- [ ] background work continues with the main window hidden
- [ ] desktop surfaces no longer require the local daemon/web UI split as a product concept

### Phase 4 — Migrate file-backed product features

Goal: local file-heavy features use desktop-owned services directly.

- [ ] artifacts list/read/write/delete
- [ ] attachments list/read/write/delete/download
- [ ] folder picker and file chooser flows
- [ ] workspace/vault inspection used by local UI
- [ ] any remaining local image/block hydrate endpoints used by conversations

### Phase 5 — Package the renderer and stop serving local UI over HTTP

Goal: local Electron mode loads packaged UI assets directly.

- [x] Load built renderer assets without the local web UI server for the window surface.
- [ ] Remove local dependency on `/api/...` for the renderer.
- [x] Replace local SSE bootstrap/event plumbing with desktop IPC/event-aware transport plumbing.
- [ ] Make desktop startup independent from starting a local web UI child process.

Success bar:

- [ ] Electron launches with packaged UI assets
- [ ] local desktop mode works without the local web server process

### Phase 6 — Delete the old local-web assumptions

Goal: remove dead architecture once local desktop parity is real.

- [ ] Delete local-only loopback web-server assumptions from the desktop shell.
- [ ] Delete local launchd/systemd product language and flows that no longer matter.
- [ ] Remove compatibility code that exists only to preserve the old local service model.
- [ ] Keep or isolate only the pieces still needed for future remote hosts.

## Required architectural seams

### 1. Host capability boundary

The renderer should talk to capabilities, not raw endpoints.

Example shape:

- conversation capability
- live session capability
- runs/tasks capability
- alerts/activity capability
- artifacts/attachments capability
- app/system capability

Local Electron host implements these through IPC.
Remote hosts can implement them later over HTTP/WebSocket/SSH.

### 2. Shared service modules

Express route files should not own product logic.

We should move reusable logic into transport-agnostic service modules that can be called from:

- Electron IPC handlers
- remote adapters
- any remaining HTTP routes still needed during migration

### 3. Desktop-owned event delivery

Local desktop eventing should move from SSE to pushed IPC subscriptions.

That includes:

- app invalidation events
- live-session transcript updates
- run/task updates
- provider OAuth and other long-running state updates

## Manual validation requirements

Every migrated slice must be tested manually in the Electron app.

Primary manual tools:

- Electron app launched locally
- `agent-browser` attached to the app through Chrome DevTools Protocol
- targeted CLI/API spot checks when needed

Minimum manual checks for each slice:

- app still launches
- opening an existing conversation works
- starting a new conversation works when relevant
- the changed flow works in the desktop app without visible regressions
- no broken desktop navigation, focus, or window behavior

## Current execution order

This is the planned implementation order unless a later slice becomes the clearer leverage point.

1. Move conversation bootstrap to the desktop capability boundary.
2. Move live session creation and prompt send to the desktop capability boundary.
3. Move local live-session streaming from SSE to IPC push.
4. Move session detail/block hydrate and transcript windowing to desktop services.
5. Move core app invalidation/event delivery to desktop IPC.
6. Move runs/tasks and activity/alerts.
7. Move artifacts/attachments and picker flows.
8. Package renderer assets directly in Electron.
9. Remove the local web UI child process from desktop mode.
10. Delete obsolete local-web and managed-service assumptions.

## Status log

### 2026-04 migration kickoff

Completed already:

- desktop runtime is now presented as app-owned instead of launchd/systemd-owned
- restart controls were removed from Settings
- live session loader prewarming landed for conversation startup

Now in progress:

- migrating the remaining non-conversation desktop surfaces off legacy local-web assumptions so the menu bar shell can delete the last child-process compatibility code
- cleaning up local launch/dev scripts and runtime diagnostics that still talk about the old web child model
- using this migration plan as the execution checklist for the full cutover

Just completed:

- local Electron conversation bootstrap now uses a desktop IPC path instead of renderer-side HTTP
- the bootstrap logic now lives in a reusable service module so the desktop app and HTTP route can share it
- local desktop JSON API calls now route through the Electron main process
- local desktop event streams for app events, live sessions, runs, and provider OAuth now resolve in-process instead of proxying through loopback HTTP
- the desktop protocol now serves local `/api/...` resource and mutation requests in-process, covering session images, attachment downloads, and residual direct fetch paths like live-session delete
- local desktop startup now treats the daemon as the only required child process; the main window can boot and run core conversation flows with the web child absent
- session-tab layout sync now uses the desktop-aware API layer instead of direct renderer fetches
- the local desktop window now loads packaged renderer assets from a desktop protocol instead of loading the app shell from `http://127.0.0.1`
