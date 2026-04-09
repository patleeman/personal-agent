# Web server route modules

The web server source now lives under `packages/web/server/`.

`index.ts` mostly bootstraps the app, builds shared context, mounts routes, and starts the HTTP server. Most HTTP behavior lives in domain folders and route registration modules.

## Server layout

Current source layout:

- `app/` — bootstrap and profile/runtime wiring
- `automation/` — daemon, inbox, alerts, deferred resumes, durable runs, scheduled tasks
- `conversations/` — live sessions, titles, cwd, recovery, conversation services
- `extensions/` — web-runtime tool extensions such as reminders, runs, tasks, artifacts, and activity
- `knowledge/` — memory docs, prompt references, vault file helpers
- `models/` — model registry, preferences, providers, auth, usage
- `routes/` — Express route registration modules
- `shared/` — app events, SSE snapshots, logging, security helpers
- `ui/` — SPA serving, companion auth, settings persistence, profile defaults
- `workspace/` — folder picker and repo-status helpers

## Two app surfaces

The server mounts routes for two related HTTP surfaces:

- the full desktop web UI
- the narrower companion surface used under `/app`

That is why many route files have both desktop and companion registration helpers.

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
- auth and companion auth
- system / web UI state
- conversations / live sessions
- activity and alerts
- runs
- memory notes / companion memory
- folder picker
- shell helpers

## Live updates

The `/api/events` SSE stream carries snapshot-style updates used by the desktop UI and the companion.

Those topics include at least:

- activity
- alerts
- sessions
- tasks
- runs
- daemon
- web UI state

The companion depends on those operational snapshots too, not just inbox-style invalidation.

## Related docs

- [Web UI Guide](./web-ui.md)
- [Electron desktop app](./electron-desktop-app-plan.md)
- [Daemon and Background Automation](./daemon.md)
