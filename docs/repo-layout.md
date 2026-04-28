# Repo Layout

This monorepo intentionally keeps package boundaries small.

## Workspace packages

- `packages/core` — shared path resolution, durable state helpers, resource loading, knowledge/project helpers, MCP helpers
- `packages/daemon` — daemon runtime, runs, automations, wakeups, companion plumbing
- `packages/cli` — `pa`
- `packages/web` — browser UI plus server routes
- `packages/desktop` — Electron shell
- `apps/ios/PersonalAgentCompanion` — native iOS companion app outside the npm workspace graph

Default rule: add a folder before adding a package.

## Repo runtime resources

These are shipped runtime inputs, not workspace packages:

- `defaults/agent/`
- `extensions/`
- `internal-skills/`
- `prompt-catalog/`
- `docs/`

## Where new code should live

### General rule

- reusable app logic shared across surfaces → `packages/core`
- long-lived unattended runtime behavior → `packages/daemon`
- CLI-only behavior → `packages/cli`
- desktop app and local API behavior → `packages/web`
- Electron-only shell behavior → `packages/desktop`

### `packages/web` rule of thumb

- route components → `packages/web/src/pages/`
- reusable UI → `packages/web/src/components/`
- conversation-specific client logic → `packages/web/src/conversation/`
- knowledge/vault UI logic → `packages/web/src/knowledge/`
- automation/run UI logic → `packages/web/src/automation/`
- browser transport and API helpers → `packages/web/src/client/`
- server routes and backend wiring → `packages/web/server/`

Current renderer routes are owned in `packages/web/src/app/App.tsx`: conversations, Knowledge, Automations, and Settings.

Do not drop new feature files at the root of `src/` if they already have an obvious home.

## Built-in extensions

Built-in extensions live under `extensions/` and resolve dependencies from the repo root install.

Only give an extension its own `package.json` when it genuinely needs dependency isolation.

## Docs and skills

- `docs/` explains product semantics for agents
- `internal-skills/` explains built-in runtime feature behavior
- repo `AGENTS.md` holds repo-specific engineering instructions

If you change product behavior, update the relevant docs.

## Other shipped clients

- `apps/ios/PersonalAgentCompanion/` — native iOS companion app. Its detailed README is the source for Xcode, simulator, mock-mode, and live-host workflows.

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Desktop App](./desktop-app.md)
- [Release Cycle](./release-cycle.md)
