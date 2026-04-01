# Web server route modules

`packages/web/server/index.ts` now mostly wires shared dependencies, mounts route modules, and starts the app. HTTP handlers live under `packages/web/server/routes/*`, and the server implementation code is grouped by domain instead of sitting flat in the root.

## Server layout

The server root is now intentionally shallow:

- `routes/` — Express route registration modules
- `conversations/` — session reads, live sessions, remote bindings, conversation memory, and conversation services
- `automation/` — daemon, runs, scheduled tasks, alerts, inbox, deferred resumes
- `workspace/` — workspace browser, git helpers, remote execution, folder picker
- `models/` — model defaults, providers, auth, usage
- `projects/` — project records, packages, resources, generated documents
- `knowledge/` — memory docs, prompt references, node links
- `ui/` — web UI config, companion auth, SPA helpers, web-specific preferences
- `extensions/` — agent extension factories
- `shared/` — shared HTTP/logging/security/event helpers

Use the route module that matches the domain first, then reach into the matching domain folder for implementation code.

## Routing pattern

Route mounting now goes through a shared `ServerRouteContext` and a single `registerServerRoutes({ app, companionApp, context })` entrypoint in `routes/`.

That means `index.ts` builds the shared context once, then the route layer handles the per-domain wiring. The important split is:

- `routes/context.ts` — typed route dependency surface
- `routes/registerAll.ts` — central route mounting order and dependency injection
- `routes/<domain>.ts` — actual handlers for each domain

This keeps the bootstrap wiring in one place instead of scattering `set*RoutesGetters(...)` calls across `index.ts`.

## Route modules worth knowing

| File | Responsibility | Notes |
| --- | --- | --- |
| `routes/conversations.ts` | conversation list/detail, artifacts, attachments, attention toggles | Uses the shared route context plus `conversations/conversationService.ts` for common session reads |
| `routes/conversationState.ts` | conversation bootstrap, recover, execution target state, title/cwd changes, model preferences | Keeps the conversation-state endpoints out of `index.ts` without bloating the main conversation list/detail routes |
| `routes/liveSessions.ts` | live session CRUD, streaming updates, session stats | Owns the live-session session-state wiring and prompt submission flow |
| `routes/runs.ts` / `routes/runsApp.ts` | durable run APIs for companion/app surfaces | App surface includes SSE/log/cancel/import; companion surface is read-focused |
| `routes/runsOps.ts` | run attention + node-distill retry/recover + remote transcript | Keeps the run-ops endpoints separate from the main run listing routes |
| `routes/workspace.ts` | workspace browsing and git operations | Injects cwd helpers and commit-message drafting |
| `routes/memoryNotes.ts` | memory browser, note CRUD, note-start flow | Uses the memory/session/project helpers that were previously inline |
| `routes/nodes.ts` | unified node-browser dataset for the Knowledge Base page | Returns the mixed note/project/skill table data with tags and node metadata |
| `routes/folderPicker.ts` | folder picker endpoint | Small wrapper around the folder picker service |
| `routes/shell.ts` | ad-hoc shell command execution | Wrapper for the `/api/run` endpoint |
| `routes/tasks.ts` | scheduled tasks and companion task run trigger | Shares task lookup logic through `taskService.ts` |
| `routes/projects.ts`, `routes/models.ts`, `routes/daemon.ts`, `routes/webUi.ts`, `routes/system.ts`, `routes/activity.ts`, `routes/alerts.ts`, `routes/auth.ts`, `routes/profiles.ts`, `routes/tools.ts`, `routes/conversationTitles.ts`, `routes/executionTargets.ts` | the remaining app/companion route domains | Existing modules, now mounted from the same barrel. `routes/models.ts` also owns runtime default settings endpoints such as `/api/default-cwd` and conversation-plan library/default routes. |

## Shared helper files

A few shared service/helper files exist to keep the route modules from becoming monoliths:

- `conversations/conversationService.ts` — shared conversation snapshot/detail/bootstrap helpers used across conversation, project, run, and companion routes
- `automation/taskService.ts` — task ID/profile lookup helpers
- `knowledge/memoryDocs.ts` — shared note, skill, and memory document helpers
- `shared/*` — cross-cutting helpers for logging, security headers, SSE/cookie helpers, and app events

## When adding or moving a route

- Put the handler in the smallest domain module that owns the behavior.
- Add the dependency to `ServerRouteContext` when the route needs shared state or helpers from `index.ts`.
- Keep status codes and error messages stable.
- Validate with:
  - `npm run build:ts`
  - `npm --prefix packages/web run build:server`

If a handler needs a helper that only exists in `index.ts`, prefer exporting the helper or moving it into the matching domain/shared file over duplicating the logic.
