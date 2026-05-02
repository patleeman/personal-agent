# Repo Layout

This monorepo keeps package boundaries small.

## Workspace packages

Monorepo packages live under `packages/` and are managed with npm workspaces.

- `packages/core` — shared utilities: path resolution, durable state helpers, resource loading, prompt catalog, knowledge/project helpers, MCP helpers, alerts, activity, checkpoints, conversation artifacts
- `packages/daemon` — daemon runtime, runs, automations, wakeups, companion plumbing, event bus
- `packages/desktop` — Electron shell + React renderer UI (merged from the former `packages/web`) + local API server routes

There are only three packages. The old `packages/web` (standalone browser UI + server) was merged into `packages/desktop` — the desktop package now owns the renderer UI (`ui/`), the server routes (`server/`), and the Electron main process (`src/`).

Other shipped directories at the repo root:

- `internal-skills/` — built-in runtime feature docs
- `prompt-catalog/` — system prompt templates
- `docs/` — product semantics for agents

## Where new code should live

- reusable app logic shared across surfaces → `packages/core`
- long-lived unattended runtime behavior → `packages/daemon`
- renderer UI, server routes, Electron shell → `packages/desktop`

### `packages/desktop` rule of thumb

- Electron main process code → `packages/desktop/src/`
- server routes and backend wiring → `packages/desktop/server/`
- React renderer UI → `packages/desktop/ui/`
  - route components → `ui/src/pages/`
  - reusable UI → `ui/src/components/`
  - conversation-specific client logic → `ui/src/conversation/`
  - knowledge/vault UI logic → `ui/src/knowledge/`
  - automation/run UI logic → `ui/src/automation/`
  - browser transport and API helpers → `ui/src/client/`

Current renderer routes are owned in `ui/src/app/App.tsx`: conversations, Knowledge, Automations, and Settings.

Do not drop new feature files at the root of `src/` if they already have an obvious home.

## Other shipped clients

- `apps/ios/PersonalAgentCompanion/` — native iOS companion app. Its detailed README is the source for Xcode, simulator, mock-mode, and live-host workflows.

## Docs and skills

- `docs/` explains product semantics for agents
- `internal-skills/` explains built-in runtime feature behavior
- repo `AGENTS.md` holds repo-specific engineering instructions

If you change product behavior, update the relevant docs.

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Desktop App](./desktop-app.md)
- [Release Cycle](./release-cycle.md)
