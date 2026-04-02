# Web server route modules

`packages/web/server/index.ts` now mostly wires shared dependencies, mounts route modules, and starts the app. HTTP handlers live under `packages/web/server/routes/*`, and the server implementation code is grouped by domain instead of sitting flat in the root.

## Server layout

The server root is now intentionally shallow:

- `routes/` — Express route registration modules
- `conversations/` — session reads, live sessions, remote bindings, conversation memory, and conversation services
- `automation/` — daemon, runs, scheduled tasks, alerts, inbox, deferred resumes, and server-side maintenance runner entrypoints
- `workspace/` — workspace browser, git helpers, remote execution, folder picker
- `models/` — model defaults, providers, auth, usage
- `projects/` — project records, packages, resources, generated documents
- `knowledge/` — memory docs, prompt references, node links
- `ui/` — web UI config, companion auth, SPA helpers, web-specific preferences
- `extensions/` — agent extension factories
- `app/` — server bootstrap/profile/runtime wiring that should not live in route modules
- `shared/` — shared HTTP/logging/security/event helpers

Use the route module that matches the domain first, then reach into the matching domain folder for implementation code. When a background helper needs a built JS entrypoint, keep that entrypoint in its domain folder and resolve it relative to the built module instead of adding top-level re-export stubs in `server/`.

## Routing pattern

Route mounting now goes through a shared `ServerRouteContext` and a single `registerServerRoutes({ app, companionApp, context })` entrypoint in `routes/`.

That means `index.ts` now delegates most startup wiring to `app/*`, builds the shared route context once, then the route layer handles the per-domain wiring. The important split is:

- `app/profileState.ts` — active-profile lifecycle, materialization, and live-session resource wiring
- `app/bootstrap.ts` — Express app setup, background monitors, static SPA mounting, and server listen helpers
- `app/routeContext.ts` — shared `ServerRouteContext` builder
- `routes/context.ts` — typed route dependency surface
- `routes/registerAll.ts` — central route mounting order and dependency injection
- `routes/<domain>.ts` — actual handlers for each domain

This keeps the bootstrap wiring in one place instead of scattering `set*RoutesGetters(...)` calls across `index.ts`. Route modules now take the context directly during registration rather than relying on exported setter functions.

On the companion surface, the `/api/events` stream also needs to carry the operational snapshots the mobile UI depends on for Tasks and System (`tasks`, `runs`, `daemon`, `sync`, and `webUi`), not just inbox-style topics.

The companion SPA fallback also has to recognize both canonical `/app/*` URLs and stripped path-proxy requests like `/inbox`, `/conversations`, `/tasks`, `/system`, `/pages`, and `/capture`, because Tailscale Serve mounts the companion behind `/app` while forwarding stripped paths to the restricted companion server.

## Route modules worth knowing

| File | Responsibility | Notes |
| --- | --- | --- |
| `routes/conversations.ts` | conversation list/detail, artifacts, attachments, attention toggles | Uses the shared route context plus `conversations/conversationService.ts` for common session reads. The companion surface also mounts the read-only session detail/meta/tree/block routes so mobile conversation links can open transcripts directly. |
| `routes/conversationState.ts` | conversation bootstrap, recover, execution target state, title/cwd changes, model preferences | Keeps the conversation-state endpoints out of `index.ts` without bloating the main conversation list/detail routes |
| `routes/liveSessions.ts` | live session CRUD, streaming updates, session stats | Owns the live-session session-state wiring and prompt submission flow |
| `routes/runs.ts` / `routes/runsApp.ts` | durable run APIs for companion/app surfaces | App surface includes SSE/log/cancel/import; companion surface is read-focused |
| `routes/runsOps.ts` | run attention + page-distill retry/recover + remote transcript | Keeps the run-ops endpoints separate from the main run listing routes |
| `routes/workspace.ts` | workspace browsing and git operations | Injects cwd helpers and commit-message drafting |
| `routes/memoryNotes.ts` | memory browser, note CRUD, note-start flow | Uses the memory/session/project helpers that were previously inline |
| `routes/nodes.ts` | unified page-browser dataset for the Pages page | Returns the mixed note/project/skill table data with tags and page metadata |
| `routes/folderPicker.ts` | folder picker endpoint | Small wrapper around the folder picker service |
| `routes/shell.ts` | ad-hoc shell command execution | Wrapper for the `/api/run` endpoint |
| `routes/tasks.ts` | scheduled tasks and companion task run trigger | Shares task lookup logic through `taskService.ts` |
| `routes/projects.ts`, `routes/models.ts`, `routes/daemon.ts`, `routes/webUi.ts`, `routes/system.ts`, `routes/activity.ts`, `routes/alerts.ts`, `routes/auth.ts`, `routes/profiles.ts`, `routes/tools.ts`, `routes/conversationTitles.ts`, `routes/executionTargets.ts` | the remaining app/companion route domains | Existing modules, now mounted from the same barrel. `routes/models.ts` also owns runtime default settings endpoints such as `/api/default-cwd` and conversation-plan library/default routes. |

## Shared helper files

A few shared service/helper files exist to keep the route modules from becoming monoliths:

- `conversations/conversationService.ts` — shared conversation snapshot/detail/bootstrap helpers used across conversation, project, run, and companion routes
- `automation/taskService.ts` — task ID/profile lookup helpers
- `knowledge/memoryDocs.ts` — shared note, skill, and memory document helpers; profile-sensitive calls now take the profile explicitly instead of relying on a module-level setter
- `shared/*` — cross-cutting helpers for logging, security headers, SSE/cookie helpers, and app events

## When adding or moving a route

- Put the handler in the smallest domain module that owns the behavior.
- Add the dependency to `ServerRouteContext` when the route needs shared state or helpers from `index.ts`.
- Keep status codes and error messages stable.
- Validate with:
  - `npm run build:ts`
  - `npm --prefix packages/web run build:server`
  - `npx vitest run $(find packages/web/server -name '*.test.ts' | sort)`

If a handler needs a helper that only exists in `index.ts`, prefer exporting the helper or moving it into the matching domain/shared file over duplicating the logic.

There is also a route-level smoke test at `packages/web/server/routes/registerAll.smoke.test.ts` that mounts the shared route registry on real Express apps and checks both app and companion surfaces.
