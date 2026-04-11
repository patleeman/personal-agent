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
- Preserve a separate companion/mobile product surface.
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
- [x] live session creation
- [x] live session prompt send / abort / queue control
- [x] session detail windowing and block hydrate
- [ ] conversation event stream / invalidation stream

### Phase 2 — Move conversation flow off the local web server

Goal: opening and using a conversation in local desktop mode should not depend on local HTTP.

- [ ] Create local desktop conversation services in the main process.
- [x] Reuse shared Node-side conversation logic without going through Express where practical.
- [x] Replace local SSE conversation updates with IPC push/subscription flows.
- [x] Move conversation open, transcript updates, send, abort, rename, cwd change, fork, and branch to IPC-backed capabilities.
- [x] Keep prewarming and transcript caches in the desktop-owned runtime.

Success bar:

- [x] opening an existing conversation is IPC-only in local desktop mode
- [x] starting a new conversation is IPC-only in local desktop mode
- [x] sending and streaming replies are IPC-only in local desktop mode

### Phase 3 — Migrate desktop runtime state and background features

Goal: the menu bar app and main process own local background behavior.

- [ ] runs list/detail/logs/events
- [x] tasks list/detail/run/edit
- [x] alerts/activity/inbox state
- [ ] reminders/deferred resumes/wakeups
- [ ] system/runtime status used by the desktop UI
- [x] provider auth and model preferences needed in the app

Success bar:

- [ ] background work continues with the main window hidden
- [ ] desktop surfaces no longer require the local daemon/web UI split as a product concept

### Phase 4 — Migrate file-backed product features

Goal: local file-heavy features use desktop-owned services directly.

- [ ] artifacts list/read/write/delete
- [ ] attachments list/read/write/delete/download
- [x] folder picker flows
- [ ] file chooser flows
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
- desktop-owned daemon and web runtime state now resolve correctly inside the Electron main process, and the remaining shell diagnostics/docs no longer describe a fake local web child
- the packaged `personal-agent://app` renderer now receives the real desktop preload bridge again, which fixes local desktop IPC transport, main-process stream bridging, and top-bar navigation controls in the packaged shell
- local desktop app bootstrap and hot app-state updates now use a dedicated desktop bridge capability instead of routing the packaged renderer through `/api/events` snapshot plumbing
- local desktop app invalidation/activity/session/task/daemon/web-ui updates can now bypass `/api/events` entirely and stream over a dedicated desktop app-events bridge from the main process
- desktop Settings no longer hides runtime/service diagnostics just because the shell is Electron; local desktop hosts show app-owned runtime messaging while remote hosts still expose their runtime panels
- local desktop live-session creation, resume, prompt send, takeover, queued prompt restore, compaction, reload, summarize-fork, branch/fork, destroy, and abort now run through dedicated desktop bridge methods instead of the generic local API path
- local desktop conversation bootstrap, rename, cwd changes, live-session status/context reads, session detail windowing, and block hydrate now also use dedicated bridge methods backed by shared Node-side conversation services, while remote hosts keep the existing HTTP fallback
- local desktop conversation model-preference reads and updates now use dedicated bridge methods instead of the generic local API path
- local desktop durable run list/detail/log/cancel now use dedicated desktop bridge methods instead of the generic local API path
- local desktop scheduled task list/detail/log/create/update/run now use dedicated desktop bridge methods instead of the generic local API path
- local desktop alerts/activity/inbox reads and mutations now use dedicated desktop bridge methods instead of the generic local API path
- local desktop provider/model operator flows now use dedicated desktop bridge methods for profiles, models, default cwd, vault root, conversation title settings, model providers, provider auth, Codex usage, and provider OAuth state/actions instead of the generic local API path
- local desktop conversation recovery and live-session fork-entry reads now use dedicated desktop bridge methods instead of the generic local API path, so forking older local conversations can stay on typed IPC while remote hosts keep the existing HTTP fallback
- packaged desktop local-api module loading now resolves the bundled `@personal-agent/web/dist-server/app/localApi.js` path in packaged builds instead of assuming a dev-worktree-relative module path
- local desktop conversation automation defaults, preset-library reads/writes, and workspace reads now use dedicated desktop bridge methods instead of the generic local API path
- conversation-plan settings normalization and persistence now live in `packages/web/server/ui/conversationPlanPreferences.ts`, shared by the HTTP model routes and the desktop local-api module
- local desktop live-session list, live-session rename, and live-session context-usage reads now use dedicated desktop bridge methods instead of the generic local API path, so the remaining local conversation workspace helpers can stay on typed IPC while remote hosts keep the existing HTTP fallback
- local desktop open-conversation tab persistence, tools page/rail reads, package installs, MCP detail reads, and instructions/memory reads+writes now also use dedicated desktop bridge methods instead of the generic local API path, while remote hosts keep the existing HTTP fallback
- local desktop conversation artifact list/detail/delete and conversation attachment list/detail/create/update/delete now use dedicated desktop bridge methods instead of the generic local API path, with shared capability logic reused by both the HTTP routes and the desktop local-api module
- local desktop conversation attachment asset reads now use a dedicated desktop bridge method instead of fetching local download URLs, so saved-drawing picker restores can stay on typed IPC while remote hosts keep the existing HTTP download fallback
- local desktop vault-file inspection and folder picking now use dedicated desktop bridge methods backed by a shared workspace capability module instead of the generic local API path, so local workspace selectors can stay on typed IPC while remote hosts keep the existing HTTP fallback
- local desktop session list, session-meta refreshes, and session search-index reads now use dedicated desktop bridge methods backed by a shared conversation-session capability module instead of the generic local API path, so the sidebar snapshot, session invalidation refreshes, and command-palette thread search can stay on typed IPC while remote hosts keep the existing HTTP fallback
- local desktop historical session block hydration now inlines session image assets as data URLs via a shared conversation-session asset capability instead of triggering follow-on `/api/sessions/.../image` fetches after `api.sessionBlock(...)`, so on-demand older image loads stay inside the typed desktop bridge while remote hosts keep the existing HTTP asset paths
- local desktop conversation bootstrap and session-detail responses now also inline session image assets for the returned transcript blocks via that same shared conversation-session asset capability, so initial local conversation rendering no longer depends on route-shaped `/api/sessions/.../image` fetches for those blocks while remote hosts keep the existing HTTP asset paths
- local desktop live-session snapshot events now inline session image assets for their streamed block payloads via that same shared conversation-session asset capability, so local transcript streaming no longer reintroduces route-shaped `/api/sessions/.../image` fetches after the initial bootstrap while remote hosts keep the existing HTTP asset paths
- local desktop shell command execution and conversation deferred-resume reads/mutations now use dedicated desktop bridge methods backed by shared workspace and conversation capability modules instead of the generic local API path, while remote hosts keep the existing HTTP fallback
- local desktop durable-run attention updates now use a dedicated desktop bridge method backed by shared durable-run capability logic instead of the generic local API path, so run review actions in the conversation rail can stay on typed IPC while remote hosts keep the existing HTTP fallback
- local desktop app startup now short-circuits the remote-only `/remote-access/session` probe instead of routing it through the generic local API path, so the packaged local app no longer spends startup work asking whether remote tailnet sign-in is required when it is known not to be
- daemon managed-service lifecycle actions now explicitly reject in desktop runtime mode instead of silently behaving like legacy launchd/systemd admin surfaces, and local desktop system views now present the daemon as an app-owned runtime rather than a restartable managed service
- local desktop application controls now stop leaning on the generic local API path: restart uses the existing desktop host restart bridge and update checks use a new desktop `checkForUpdates()` bridge, while managed daemon/web UI service actions short-circuit locally with desktop-runtime errors
- the separate companion product surface has now been removed: the web build no longer emits the `/app` companion shell, the server bootstrap no longer runs a second companion app/server, `App.tsx` no longer mounts companion routes, `apiBase` no longer branches to `/app/api`, and the companion frontend/PWA/assets were deleted so future work only targets the main web/desktop surface
- web UI runtime state and config were simplified around the single remaining surface: `companionPort`/`companionUrl` were removed from machine config, web UI state, desktop bridge signatures, and Tailscale Serve wiring, while the remaining pairing/admin UI now describes remote browser access instead of a phone companion product
- validation for the companion-surface removal slice: targeted Vitest coverage in `packages/services/src/tailscale-serve.test.ts`, `packages/web/src/apiBase.test.ts`, `packages/web/src/webUiRemoteAccess.test.ts`, `packages/web/src/components/SystemContextPanel.test.tsx`, `packages/web/src/pages/SystemPage.test.tsx`, `packages/web/src/pages/SettingsPage.test.tsx`, `packages/web/server/app/bootstrap.test.ts`, `packages/web/server/app/bootstrap.monitors.test.ts`, `packages/web/server/routes/registerAll.smoke.test.ts`, `packages/web/server/ui/spaIndex.test.ts`, `packages/web/server/ui/webUi.test.ts`, `packages/web/src/api.desktop.test.ts`, and `packages/desktop/src/hosts/local-host-controller.test.ts`, plus focused eslint, `npm --prefix packages/web run build`, `npm --prefix packages/desktop run build`, and built Electron smoke checks confirming the packaged shell still renders at `personal-agent://app/conversations/new` with `window.personalAgentDesktop` available
- the remote browser pairing/admin surface has now been renamed away from the old companion product framing: the public admin routes moved from `/api/companion-auth` to `/api/remote-access`, the desktop bridge/api/CLI now use remote-access naming, and the legacy companion session exchange/session/logout routes were dropped instead of being kept around as dead compatibility surface
- CLI foreground/runtime cleanup now matches the single-surface web product: `pa ui` no longer looks for or exports a companion port, Tailscale Serve status/output only describes the root web UI mapping, and `pa ui pairing-code` now targets the renamed remote-access admin route and speaks only about remote browser access
- the dead companion route scaffolding has now been pruned: unused `registerCompanion*` route helpers and their duplicated tests were removed across conversations, live sessions, system, tasks, runs, daemon, models, and web-ui routing, and the stale companion-only conversation-list helpers were deleted from `conversationService.ts`
- the remaining internal auth/storage cleanup has now gone further: remote access sessions no longer carry the old desktop-vs-legacy surface split, the remote sign-in routes now live under `/api/remote-access/session|exchange|logout`, and the auth store now reads and writes only `remote-access-auth.json`
- validation for the route/auth cleanup slice: targeted Vitest coverage in `packages/web/server/routes/conversations.test.ts`, `packages/web/server/routes/liveSessions.routes.test.ts`, `packages/web/server/routes/system.routes.test.ts`, `packages/web/server/routes/tasks.test.ts`, `packages/web/server/routes/runs.test.ts`, `packages/web/server/routes/daemon.test.ts`, `packages/web/server/routes/models.test.ts`, `packages/web/server/routes/webUi.test.ts`, `packages/web/server/conversations/conversationService.test.ts`, `packages/web/server/routes/auth.test.ts`, `packages/web/server/routes/registerAll.smoke.test.ts`, `packages/web/src/api.desktop.test.ts`, `packages/web/src/apiBase.test.ts`, `packages/web/src/components/SystemContextPanel.test.tsx`, `packages/web/src/pages/SystemPage.test.tsx`, `packages/web/src/pages/SettingsPage.test.tsx`, `packages/desktop/src/hosts/local-host-controller.test.ts`, and `packages/cli/src/ui-commands.test.ts`, plus focused eslint, `npm --prefix packages/cli run build`, `npm --prefix packages/desktop run build`, and built Electron smoke checks confirming the packaged shell still boots and Settings still renders cleanly
- the remaining low-value UI/internal `companion` naming has been trimmed further: the dead companion-only slash-menu helper was removed, `ChatView` now uses `compact` layout naming, note CSS/test fixture names were cleaned, the last dead companion-only server helpers were removed from `packages/web/server/index.ts`, and the web UI docs now describe remote browser access instead of a companion surface
- prompt-start hot path was trimmed for plain prompts: `submitLiveSessionPromptCapability(...)` now skips task/note/vault reference catalog work when the prompt has no real `@...` mentions, and it also skips unified-node graph expansion when no note/project/skill references resolved
- validation for the prompt-start perf slice: targeted Vitest in `packages/web/server/routes/liveSessions.routes.test.ts`, focused eslint on `packages/web/server/conversations/liveSessionCapability.ts` and the touched route test, `npm --prefix packages/desktop run build`, and packaged-Electron bridge timing checks showing a plain local desktop prompt-start drop from roughly `175ms` to `49ms` on the measured path
- new-conversation open path was trimmed by returning a synthetic empty bootstrap payload from live-session creation and priming the conversation bootstrap/session-detail caches before desktop navigation, so freshly created local conversations no longer wait on an immediate follow-on bootstrap read just to render an empty transcript shell
- validation for the create/bootstrap open-path perf slice: targeted Vitest in `packages/web/server/routes/liveSessions.routes.test.ts`, `packages/web/src/api.desktop.test.ts`, `packages/desktop/src/hosts/local-host-controller.test.ts`, and `packages/web/src/pages/ConversationPage.test.tsx`, focused eslint on the touched live-session/desktop/web files, `npm --prefix packages/desktop run build`, and packaged-Electron timing checks showing local desktop conversation-open content completion drop from roughly `44ms` to `2ms` on the measured create-then-open path while the composer remained visible with no loading spinner
- draft submit now hands off the first prompt in the background after navigation instead of holding the route transition open on the prompt-start RPC, while keeping a pending-prompt mirror plus an in-flight guard so the new conversation page can show optimistic state and only retry if the detached start fails
- validation for the draft-submit perf slice: targeted Vitest in `packages/web/src/pendingConversationPrompt.test.ts` and `packages/web/src/pages/ConversationPage.test.tsx`, focused eslint on the touched web files, `npm --prefix packages/desktop run build`, and packaged-Electron timing checks showing the measured local desktop draft-submit route transition drop from roughly `281ms` to `99ms` on the real new-conversation path
- durable run snapshots now flow through the dedicated desktop app-events path instead of being dropped from local desktop bootstrap/invalidation delivery, so the packaged app can keep run state warm through the same desktop-native event channel as sessions/tasks/alerts instead of leaning on legacy `/api/events` semantics for that slice
- validation for the durable-run app-events slice: targeted Vitest in `packages/web/src/appEventTransport.test.ts` and `packages/web/server/routes/system.routes.test.ts`, focused eslint on the touched app-event files, `npm --prefix packages/desktop run build`, and packaged-Electron smoke checks navigating the local app shell and Runs page
- removed the dead per-conversation plan echo surface (`GET/PATCH /api/conversations/:id/plan` plus item reset/status mutations) along with the unused frontend API helpers, since those routes were placeholder no-op mirrors with no live callers and were only keeping a fake local-web endpoint shape around the desktop-first codebase
- validation for the dead conversation-plan cleanup slice: targeted Vitest in `packages/web/server/routes/conversations.test.ts`, focused eslint on the touched API/route files, `npm --prefix packages/desktop run build`, and a packaged-Electron smoke check that the local shell still boots
- removed the renderer-only generic `invokeLocalApi` desktop bridge path from `api.ts`, preload, and IPC registration; local desktop now relies on dedicated typed bridge methods for native capabilities and the packaged protocol `/api/...` fetch path for the small remaining HTTP-backed flows, instead of carrying a second generic local-API call channel inside the renderer
- validation for the renderer local-api bridge cleanup slice: targeted Vitest in `packages/web/src/api.desktop.test.ts`, focused eslint on the touched desktop/web bridge files, `npm --prefix packages/desktop run build`, and a packaged-Electron smoke check confirming the app still boots with `window.personalAgentDesktop.invokeLocalApi === undefined`
- removed the dead renderer-facing runtime/service lifecycle API surface (`restartApplication`, `updateApplication`, daemon service lifecycle methods, web-ui service lifecycle methods) along with the matching preload/IPC bridge exposure for `restartActiveHost` and `checkForUpdates`; the renderer no longer carries restart/install/update helpers that had no live callers after the runtime panels were simplified
- validation for the renderer runtime-action cleanup slice: targeted Vitest in `packages/web/src/api.desktop.test.ts`, focused eslint on the touched desktop/web bridge files, `npm --prefix packages/desktop run build`, and a packaged-Electron smoke check confirming the app still boots with `window.personalAgentDesktop.restartActiveHost === undefined` and `checkForUpdates === undefined`
- current focus after this slice: keep tightening startup/new-conversation perf on top of the simplified single-surface architecture while continuing to burn down the remaining local-web assumptions
