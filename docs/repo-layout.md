# Repo layout

`personal-agent` keeps the monorepo intentionally small.

## Workspace boundaries

There are only five workspace packages:

- `packages/core` — shared durable-state, profile/resource loading, knowledge, MCP, and utility logic
- `packages/daemon` — background runtime, durable runs, scheduled tasks, managed service helpers, and other automation plumbing
- `packages/cli` — the `pa` command surface
- `packages/web` — the browser app plus its server routes
- `packages/desktop` — the Electron shell

That split is deliberate:

- `core` is the default home for reusable app logic
- `daemon` owns background/runtime concerns that should not leak into every surface
- `cli`, `web`, and `desktop` are product surfaces, not general-purpose utility packages

If new code does not need a new deployment boundary, keep it inside one of those existing packages.

## `packages/web` structure

The web package is big enough that folder boundaries matter.

Use these defaults:

- `packages/web/src/pages/` — route-level UI surfaces
- `packages/web/src/components/` — reusable UI pieces
- `packages/web/src/automation/` — automation/run presentation helpers, task schedule parsing, and scheduled-task detail guards
- `packages/web/src/commands/` — slash-command discovery, command palette ranking, and command-palette event helpers
- `packages/web/src/conversation/` — conversation-specific client helpers, including draft/fork state, related-thread search, search state helpers, formatting helpers, and parsing logic
- `packages/web/src/deferred-resume/` — deferred-resume parsing, labeling, and browser-local deferred resume helpers
- `packages/web/src/desktop/` — desktop-shell bridge helpers, desktop-only event plumbing, and desktop UI support logic
- `packages/web/src/knowledge/` — note/skill/note-mention helpers, markdown document helpers, and knowledge-workspace presentation utilities
- `packages/web/src/local/` — browser-local storage, persisted UI state, saved workspace path helpers, and local-path detection helpers
- `packages/web/src/model/` — model filtering, grouping, and model-preference presentation helpers
- `packages/web/src/navigation/` — route redirects, lazy-route recovery, and URL search-param selection helpers for cross-page navigation
- `packages/web/src/pending/` — pending prompt persistence and optimistic pending-message presentation helpers
- `packages/web/src/session/` — session snapshot, tab layout, refresh scheduling, and session attention helpers
- `packages/web/src/transcript/` — transcript block transformation, interactive transcript tool-block helpers, and streaming status presentation
- `packages/web/src/ui-state/` — browser-only theme, panel sizing, warm live-session cache, and open-shelf UI state helpers
- `packages/web/src/hooks/` — reusable React hooks and hook-backed data helpers
- `packages/web/server/` — server routes, automation wiring, conversation backends, and shared server utilities

If a new client-side helper is clearly conversation-specific, keep it under `src/conversation/` instead of dropping another `conversation*` file into `src/`.
If it formats or validates automation and durable-run UI state, keep it under `src/automation/`.
If it powers slash-command discovery or command-palette ranking/event wiring, keep it under `src/commands/`.
If it exists to parse or present deferred resume state, keep it under `src/deferred-resume/`.
If it only exists because the Electron shell injects extra capabilities, keep it under `src/desktop/`.
If it manages markdown/note/skill/node-mention rendering for the knowledge surfaces, keep it under `src/knowledge/`.
If it manages browser-local persistence or saved local workspace state, keep it under `src/local/`.
If it manages model filtering or reusable model preference presentation logic, keep it under `src/model/`.
If it manages route redirects or search-param driven page navigation state, keep it under `src/navigation/`.
If it manages pending prompt staging or optimistic pending-message state, keep it under `src/pending/`.
If it manages session list, tab, or snapshot state, keep it under `src/session/`.
If it transforms or annotates transcript blocks for the chat surface, keep it under `src/transcript/`.
If it manages browser-only theme or layout/view state, keep it under `src/ui-state/`.

## Repo-level runtime resources

Some important repo directories are not workspace packages at all:

- `defaults/agent/`
- `extensions/`
- `internal-skills/`
- `prompt-catalog/`
- `themes/`

Those ship as repo-managed runtime resources.

## Built-in extension dependency rule

Built-in extensions under `extensions/` resolve their dependencies from the repo root `package.json` and top-level `node_modules`.

That keeps the repo from growing nested package islands for every built-in extension.

Only add a local extension `package.json` when the extension truly needs isolation from the main app dependency graph, and document why.

## What to avoid

Avoid introducing new workspaces for:

- one-off helpers
- thin wrappers around existing `core` or `daemon` code
- a single extension with a couple of dependencies
- surface-local code that can live under `packages/cli`, `packages/web`, or `packages/desktop`

The default move should be: add a folder, not a package.

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Command-Line Guide (`pa`)](./command-line.md)
- [Release cycle](./release-cycle.md)
- [Web server route modules](./web-server-routing.md)
