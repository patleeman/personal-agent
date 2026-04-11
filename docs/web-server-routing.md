# Web server route modules

The web server source now lives under `packages/web/server/`.

`index.ts` mostly bootstraps the app, builds shared context, mounts routes, and starts the HTTP server. Most HTTP behavior lives in domain folders and route registration modules.

## Server layout

Current source layout:

- `app/` — bootstrap and profile/runtime wiring
- `automation/` — daemon, deferred resumes, durable runs, scheduled tasks, and remaining attention helpers
- `conversations/` — live sessions, titles, cwd, recovery, conversation services
- `extensions/` — web-runtime tool extensions such as reminders, runs, tasks, artifacts, and activity
- `knowledge/` — memory docs, prompt references, vault file helpers
- `models/` — model registry, preferences, providers, auth, usage
- `routes/` — Express route registration modules
- `shared/` — app events, SSE snapshots, logging, security helpers
- `ui/` — SPA serving, remote-access auth, settings persistence, profile defaults
- `workspace/` — folder picker and repo-status helpers

## App surface

The server now mounts one browser surface: the main web UI.

Remote browser pairing/admin state still exists, but the old `/app` companion surface and its duplicated route helpers are gone.

## Route registration pattern

Route mounting goes through a shared context and one central entrypoint:

- `routes/context.ts` — typed route dependency surface
- `routes/registerAll.ts` — route mounting order and dependency injection
- `app/routeContext.ts` — builder for the shared `ServerRouteContext`

The important point is that route modules get the context directly during registration instead of relying on scattered setter functions.

## Notable route groups

Current route groups include:

- profiles
- daemon
- tasks
- models
- tools
- auth and remote-access auth
- system / web UI state
- conversations / live sessions
- internal attention helpers (tool-facing, not a public app surface)
- runs
- memory notes
- folder picker
- shell helpers

## Live updates

The `/api/events` SSE stream carries snapshot-style updates used by the desktop UI and remote browser sessions.

Those topics include at least:

- sessions
- tasks
- runs
- daemon
- web UI state

Remote browser sessions depend on those operational snapshots too, not just session invalidation.

## Related docs

- [Web UI Guide](./web-ui.md)
- [Electron desktop app](./electron-desktop-app-plan.md)
- [Daemon and Background Automation](./daemon.md)
