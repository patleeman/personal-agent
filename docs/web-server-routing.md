# Web server route modules

`packages/web/server/index.ts` now mostly wires shared dependencies, mounts route modules, and starts the app. Most HTTP handlers live under `packages/web/server/routes/*`.

A small number of desktop-only conversation handlers still live in `index.ts` because they currently depend on shared bootstrap/recovery wiring that has not been extracted yet:

- `/api/conversations/:id/bootstrap`
- `/api/conversations/:id/model-preferences`
- `/api/conversations/:id/recover`
- `/api/conversations/:id/execution`
- `/api/conversations/:id/title`
- `/api/conversations/:id/cwd`

Use the route module that matches the domain first; only reach back into `index.ts` when a handler truly needs shared wiring that is not worth duplicating.

## Routing pattern

Most modules follow the same shape:

- `set*RoutesGetters(...)` or `set*RoutesProfileGetter(...)` for injected dependencies
- `register*Routes(router)` for the actual handlers
- `routes/index.ts` as the single export barrel

This keeps cross-module dependencies explicit and avoids circular imports.

## Route modules worth knowing

| File | Responsibility | Notes |
| --- | --- | --- |
| `routes/conversations.ts` | conversation list/detail, artifacts, attachments, model preferences | Uses `setConversationRoutesGetters(...)` to wire repo/profile/preferences access |
| `routes/liveSessions.ts` | live session CRUD, streaming updates, session stats | Owns the live-session session-state wiring |
| `routes/runs.ts` / `routes/runsApp.ts` | durable run APIs for companion/app surfaces | App surface includes SSE/log/cancel/import; companion surface is read-focused |
| `routes/runsOps.ts` | run attention + node-distill retry/recover + remote transcript | Keeps the run-ops endpoints separate from the main run listing routes |
| `routes/workspace.ts` | workspace browsing and git operations | Injects cwd helpers and commit-message drafting |
| `routes/memoryNotes.ts` | memory browser, note CRUD, note-start flow | Uses the memory/session/project helpers that were previously inline |
| `routes/folderPicker.ts` | folder picker endpoint | Small wrapper around the folder picker service |
| `routes/shell.ts` | ad-hoc shell command execution | Wrapper for the `/api/run` endpoint |
| `routes/tasks.ts` | scheduled tasks and companion task run trigger | Shares task lookup logic through `taskService.ts` |
| `routes/projects.ts`, `routes/models.ts`, `routes/daemon.ts`, `routes/webUi.ts`, `routes/system.ts`, `routes/activity.ts`, `routes/alerts.ts`, `routes/auth.ts`, `routes/profiles.ts`, `routes/tools.ts`, `routes/conversationTitles.ts`, `routes/executionTargets.ts` | the remaining app/companion route domains | Existing modules, now mounted from the same barrel. `routes/models.ts` also owns runtime default settings endpoints such as `/api/default-cwd` and conversation-plan library/default routes. |

## Shared helper files

A few small service files exist to keep the route modules from becoming monoliths:

- `taskService.ts` — task ID/profile lookup helpers
- `memoryDocs.ts` — shared note, skill, and memory document helpers

## When adding or moving a route

- Put the handler in the smallest domain module that owns the behavior.
- Add a setter when the route needs a shared dependency from `index.ts`.
- Keep status codes and error messages stable.
- Validate with:
  - `npm run build:ts`
  - `npm --prefix packages/web run build:server`

If a handler needs a helper that only exists in `index.ts`, prefer exporting the helper or moving it into a service file over duplicating the logic.
