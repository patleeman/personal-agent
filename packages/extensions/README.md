# Personal Agent Extension SDK

This package is the public import surface for native Personal Agent extensions. Extension code should import from `@personal-agent/extensions` and its subpath modules instead of reaching into `packages/desktop` internals. Backend extensions must use host capabilities such as `ctx.shell` for process execution; direct Node process APIs are blocked so the host can apply sandbox and execution-wrapper policy.

This doc is written for agents building extensions. Read it before creating or editing an extension, then inspect the current schema/types and nearby system extensions for exact examples.

## Platform rule

Build new Personal Agent product features as extensions by default. Core is the small, stable platform: agent/conversation runtime, model and tool protocol, transcript/event stream, durable storage primitives, knowledge/system-prompt assembly, extension host/manifest/API/permissions, security boundaries, app shell/routing, install/update plumbing, and shared UI primitives.

User-facing, domain-specific, and workflow-specific behavior belongs in extensions: pages, panels, tool renderers, commands, integrations, context providers, automations, import/export flows, diagnostics views, settings sections, and opinionated UX.

If the SDK lacks a host primitive needed by a first-party extension, add a reusable API to `@personal-agent/extensions` instead of importing app internals or hardcoding the feature in the app shell. Core should make features possible; extensions should be where features live.

## Agent workflow

When asked to build or modify an extension:

1. Inspect existing extension IDs, routes, commands, and surfaces before choosing names.
2. Create editable source files, not dist-only output.
3. Declare all host contributions in `extension.json` and all Node dependencies in `package.json`.
4. Use `@personal-agent/extensions` as the SDK seam. Do not import from `packages/desktop/ui/src/...` or `packages/desktop/server/...`.
5. Run the repo-owned extension build and reload extensions.
6. Visually inspect any UI surface you changed.
7. Checkpoint only the files you touched.

Do not create new iframe or webview extensions. Native extensions render React components inside the Personal Agent UI.

## Where extensions live

User-created extensions live in runtime state by default:

```text
~/.local/state/personal-agent/extensions/{extension-id}/
```

Bundled first-party extensions live in the repo under `extensions/`. They use the same contract as user extensions and are good examples when you need to copy a working shape.

The loader also accepts package roots through `PERSONAL_AGENT_EXTENSION_PATHS`. Each path can point directly at a folder with `extension.json` or at a parent folder containing many extension packages.

A native extension package usually looks like this:

```text
agent-board/
  extension.json
  package.json
  README.md
  src/
    frontend.tsx
    backend.ts
    styles.css
  dist/
    frontend.js
    frontend.css
    backend.mjs
  skills/
    agent-board/SKILL.md
```

`src/` is the source of truth. `dist/` is generated output that the runtime loads.

## Build and reload loop

Personal Agent owns the build command. Run it from the repo root:

```bash
pnpm run extension:build -- ~/.local/state/personal-agent/extensions/agent-board
```

The builder compiles frontend React to `dist/frontend.js`, backend Node code to `dist/backend.mjs`, and bundles normal third-party dependencies. Host packages such as `react`, `react-dom`, and `@personal-agent/extensions` are treated as provided by the app. Backend `dist/` output is the runtime contract for system extensions, and stale or missing system-extension bundles fail validation.

Packaged desktop releases only load prebuilt `dist/` files. They do not run esbuild for extensions at runtime, so imported/user extensions must already include their built frontend/backend bundles.

After building, reload extensions from the Extension Manager or the app reload path. If you changed UI, open the declared route or right-rail surface and visually inspect it.

## Manifest contract

Every extension package has an `extension.json` manifest. The desktop runtime validates the manifest before loading the extension, so malformed contributions fail fast instead of turning into mystery UI bugs.

Supported top-level fields:

- `schemaVersion`: currently `2`.
- `id`, `name`, `description`, `version`, `packageType`.
- `frontend`: native React bundle entry and optional styles.
- `backend`: backend module entry, backend actions, and optional agent lifecycle factory.
- `contributes`: views, nav, commands, keybindings, slash commands, mentions, quick-open providers, prompt reference resolvers, skills, tools, transcript renderers, themes, topBarElements, messageActions, composerShelves, toolbarActions, conversationDecorators, contextMenus, statusBarItems, and settings metadata.
- `permissions`: declared capability intent.

Minimal example:

```json
{
  "schemaVersion": 2,
  "id": "agent-board",
  "name": "Agent Board",
  "description": "Kanban board for agent-executed tasks.",
  "version": "0.1.0",
  "frontend": {
    "entry": "dist/frontend.js",
    "styles": ["dist/frontend.css"]
  },
  "backend": {
    "entry": "dist/backend.mjs",
    "actions": [{ "id": "createTask", "handler": "createTask", "title": "Create task" }]
  },
  "contributes": {
    "views": [
      {
        "id": "page",
        "title": "Agent Board",
        "location": "main",
        "route": "/ext/agent-board",
        "component": "AgentBoardPage"
      }
    ],
    "nav": [{ "id": "nav", "label": "Agent Board", "icon": "kanban", "route": "/ext/agent-board" }]
  },
  "permissions": ["storage:readwrite"]
}
```

Rules:

- `id` is stable kebab-case.
- Use `/ext/{id}` by convention for user extension pages unless you have a strong reason not to.
- The manifest declares what exists; code implements the behavior.
- Renderable views point to named frontend exports.
- Backend actions point to named backend exports.
- Color themes are token maps under `contributes.themes`; use `--color-*` CSS variables with RGB triplet strings.
- Permissions are intent declarations today and should match what the extension can do.

## Color themes

Extensions can contribute color-only themes without frontend code. Theme IDs are scoped by extension at runtime, so `solarized-dark` from `agent-board` is stored and applied as `agent-board/solarized-dark`.

```json
{
  "contributes": {
    "themes": [
      {
        "id": "solarized-dark",
        "label": "Solarized Dark",
        "appearance": "dark",
        "tokens": {
          "--color-base": "0 43 54",
          "--color-surface": "7 54 66",
          "--color-elevated": "13 65 78",
          "--color-panel": "0 36 46",
          "--color-border-subtle": "38 84 94",
          "--color-border-default": "48 104 117",
          "--color-primary": "238 232 213",
          "--color-secondary": "147 161 161",
          "--color-dim": "101 123 131",
          "--color-accent": "38 139 210",
          "--color-accent-bg": "7 54 66",
          "--color-success": "133 153 0",
          "--color-warning": "181 137 0",
          "--color-danger": "220 50 47"
        }
      }
    ]
  }
}
```

The built-in themes are `tokyo-night-light` and `tokyo-night-dark`. Legacy stored preferences `light` and `dark` still resolve to those built-ins.

## Dependencies

Extensions declare Node dependencies in their own `package.json`, not in `extension.json`. The manifest describes host contributions and capability intent.

### Dependency resolution during build

The build system uses esbuild to bundle extension code. Third-party dependencies are **bundled into the output** at build time — they are not resolved at runtime.

Resolution order:

1. The extension's own `node_modules/` (`pnpm install` in the extension directory)
2. The app's own `node_modules/` (fallback — any dep the app already has is available)
3. Custom build (if you need a different build setup, build the dist files yourself)

This means:

- **Host packages** (`@personal-agent/extensions`, subpath imports, `react`) are always available — marked external in the esbuild config, resolved from the host at runtime.
- **If a dep is already in the app** (like `zod`, `date-fns`, `nanoid`), you can import it without any setup — it resolves through the fallback path.
- **If you need a dep the app doesn't have**, run `pnpm add <pkg>` in the extension directory before building.
- **If you need a custom build** (different bundler, plugins, externals), build `dist/` yourself. The app loads whatever `dist/frontend.js` and `dist/backend.mjs` exist.

### package.json

```json
{
  "type": "module",
  "dependencies": {
    "@personal-agent/extensions": "*",
    "some-runtime-lib": "^1.2.3"
  }
}
```

`@personal-agent/extensions` is the host SDK — listed as a reminder of the contract, not for npm resolution.

### Agent workflow for extensions with deps

```bash
# 1. Create the extension (or place it in ~/.local/state/personal-agent/extensions/{id}/)
# 2. If you need a dep the app doesn't already ship:
pnpm --dir ~/.local/state/personal-agent/extensions/my-ext add zod
# 3. Build
pnpm run extension:build -- ~/.local/state/personal-agent/extensions/my-ext
# 4. Reload (from Extension Manager UI or app restart)
```

If you omit `pnpm install`, esbuild falls back to the app's `node_modules/`. If the dep isn't there either, the build fails — add it with `pnpm add`.

## Public imports

Use these modules as the paved road:

```ts
import type { ExtensionBackendContext, ExtensionManifest, ExtensionSurfaceProps } from '@personal-agent/extensions';
import { AppPageLayout, EmptyState, ToolbarButton } from '@personal-agent/extensions/ui';
import { api, timeAgo, useAppData } from '@personal-agent/extensions/data';
import { WorkbenchBrowserTab, WorkspaceExplorer } from '@personal-agent/extensions/workbench';
import { SettingsPage } from '@personal-agent/extensions/settings';
```

System backend extensions can also import deliberate backend primitives through the backend seam:

```ts
import { createScheduledTask } from '@personal-agent/extensions/backend';
```

Prefer focused backend subpaths for narrow primitives so extension bundles do not pull in unrelated host seams:

```ts
import { saveConversationCommitCheckpoint } from '@personal-agent/extensions/backend/checkpoints';
```

Extensions can record fire-and-forget app telemetry through the dedicated telemetry seam:

```ts
import { recordTelemetryEvent } from '@personal-agent/extensions/backend/telemetry';

recordTelemetryEvent({ source: 'agent', category: 'my_extension', name: 'action_completed', durationMs: 42 });
```

Backend action handlers can also use `ctx.telemetry.record(...)`, which automatically annotates metadata with the current extension id.

If a system extension needs a host primitive that is not exported here, add it deliberately to this package as a reusable SDK capability. Do not punch through into app internals, and do not hardcode one-off product behavior in the app shell.

## Frontend surfaces

A frontend surface exports a React component referenced by `contributes.views[].component`:

```tsx
import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import { AppPageLayout, EmptyState, ToolbarButton } from '@personal-agent/extensions/ui';

export function AgentBoardPage({ pa, context }: ExtensionSurfaceProps) {
  return (
    <AppPageLayout title="Agent Board" summary={`Conversation: ${context.conversationId ?? 'none'}`}>
      <ToolbarButton onClick={() => pa.extension.invoke('createTask', { conversationId: context.conversationId })}>New task</ToolbarButton>
      <EmptyState title="No tasks yet" body="Create a task from a conversation or start one here." />
    </AppPageLayout>
  );
}
```

Surface components receive props. Do not read globals like `window.PA`; it makes tests and reload behavior worse.

The host provides `pa` for stable app capabilities: backend action invocation, extension storage, workspace files, runs, automations, browser state, and lightweight UI prompts. Prefer PA components for common app chrome, but use normal React and scoped CSS for custom product UI.

Every extension renders under a host root such as `<section data-extension-id="agent-board">`. Keep CSS scoped to the extension and avoid global shell-looking selectors.

## Backend actions

Backend entries are separate from frontend entries. Keep browser React code and Node capability code apart.

Backend extensions export handlers referenced by `backend.actions[].handler`:

```ts
import type { ExtensionBackendContext } from '@personal-agent/extensions';

export async function createTask(input: { title?: string; conversationId?: string }, ctx: ExtensionBackendContext) {
  const id = crypto.randomUUID();
  const task = {
    id,
    title: input.title ?? 'Untitled task',
    conversationId: input.conversationId ?? null,
    createdAt: new Date().toISOString(),
  };

  await ctx.storage.put(`tasks/${id}`, task);
  return task;
}
```

Frontend code calls backend actions through the host seam:

```ts
await pa.extension.invoke('createTask', { title: 'Write docs' });
```

Do not import backend handlers directly into frontend components. Browser/Node boundary lies are expensive and stupid.

Backend actions receive capability namespaces through `ctx`, including extension storage and backend-only capabilities such as workspace, git, shell, runs, and automations where available. Use those seams instead of importing app internals.

## Agent lifecycle hooks

Backend-only extensions can contribute a pi agent extension factory for lifecycle-level behavior such as provider request rewriting, session compaction hooks, or other `pi.on(...)` event work that has no UI surface.

Declare the exported factory in the backend manifest:

```json
{
  "backend": {
    "entry": "dist/backend.mjs",
    "agentExtension": "default"
  }
}
```

The backend module exports a normal pi extension factory:

```ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function agentLifecycleExtension(pi: ExtensionAPI): void {
  pi.on('session_before_compact', async (event, ctx) => {
    // Return pi-compatible lifecycle results here.
  });
}
```

Enabled extension agent factories are discovered from manifests and appended to live session startup. Do not wire a system extension directly into runtime files when `backend.agentExtension` is the right seam.

## Mentions, quick open, and prompt references

Extensions can add items to composer `@` mentions, command-palette quick open, and hidden prompt-context resolution. Keep these three pieces aligned when they represent the same domain object.

Mention providers run in the frontend and return selectable `@` menu items:

```json
{
  "contributes": {
    "mentions": [
      {
        "id": "agent-board-cards",
        "title": "Agent Board cards",
        "kinds": ["card"],
        "provider": "buildAgentBoardMentionItems"
      }
    ]
  }
}
```

Quick-open providers also run in the frontend and add extension-owned command palette tabs:

```json
{
  "contributes": {
    "quickOpen": [
      {
        "id": "agent-board-cards",
        "provider": "agentBoardQuickOpenProvider",
        "title": "Cards",
        "section": "agent-board-cards",
        "order": 20
      }
    ]
  }
}
```

The provider export can implement `list()` for empty-query browsing and `search(query, limit)` for content search. Returned items include `title`, optional `subtitle`/`meta`/`keywords`, and an action such as `{ "kind": "navigate", "to": "/ext/agent-board" }` or `{ "kind": "openFile", "fileId": "notes/example.md" }`. Omit item `section` to use the contribution's tab; set it only when deliberately returning items for another quick-open surface.

Prompt reference resolvers run in the backend during prompt submission. Use them when an `@` mention should inject hidden context into the agent turn:

```json
{
  "backend": {
    "entry": "dist/backend.mjs",
    "actions": [{ "id": "resolvePromptReferences", "handler": "resolvePromptReferences" }]
  },
  "contributes": {
    "promptReferences": [{ "id": "agent-board-cards", "handler": "resolvePromptReferences" }]
  }
}
```

The handler receives `{ text, mentionIds }` and returns `{ contextBlocks, references }`. Context blocks are appended to hidden prompt context; references are echoed in prompt submission metadata when relevant.

## Agent skills and tools

Extensions can contribute agent skills and agent tools. These are runtime-mounted from the enabled extension package; they are not copied into the knowledge vault.

Use extension skills for local instructions that explain how to use the extension, its tools, or its domain model:

```json
{
  "contributes": {
    "skills": [
      {
        "id": "agent-board",
        "title": "Agent Board",
        "description": "Use when planning or executing Agent Board tasks.",
        "path": "skills/agent-board/SKILL.md"
      }
    ]
  }
}
```

Use extension tools when the agent needs executable runtime behavior backed by extension code:

```json
{
  "backend": { "entry": "dist/backend.mjs", "actions": [{ "id": "createTask", "handler": "createTask" }] },
  "contributes": {
    "tools": [
      {
        "id": "create-task",
        "title": "Create Agent Board task",
        "description": "Create a task on the Agent Board.",
        "action": "createTask",
        "inputSchema": {
          "type": "object",
          "properties": { "title": { "type": "string" } },
          "required": ["title"],
          "additionalProperties": false
        }
      }
    ]
  }
}
```

The runtime registers a stable generated tool name: `extension_{extensionId}_{toolId}` with non-identifier characters normalized to underscores. Keep tools coarse and useful; do not expose every button click as an agent tool.

## Surfaces and contribution choices

Pick the smallest surface that matches the product shape. Do not use the right rail as a junk drawer.

| Surface                | Use for                                                                | Avoid using for                  |
| ---------------------- | ---------------------------------------------------------------------- | -------------------------------- |
| Main page view         | Durable app-level workflows with their own route                       | Tiny contextual helpers          |
| Left nav item          | Primary destinations users should see every day (`section: 'primary'`) | Settings subpanels               |
| Nav item (settings)    | Settings/configuration destinations (`section: 'settings'`)            | Product workflows                |
| Right-rail panel       | Compact contextual companions for a conversation/workspace/selection   | Wide editors or log/diff viewers |
| Workbench detail view  | Large detail rendering paired to a right-rail selector                 | Standalone app-level workflows   |
| Settings contribution  | Configuration and preferences                                          | Product workflows                |
| Command                | Fast one-shot actions or opening a surface                             | Persistent UI                    |
| Slash command          | Conversation-authored actions that affect prompt context               | Global app navigation            |
| Top bar element        | Status indicator icon/badge in the top bar                             | Full UI surfaces                 |
| Message action         | Hover-reveal action button on a message block                          | Persistent UI elements           |
| Toolbar action         | Icon button in the composer toolbar row                                | Text-heavy actions               |
| Composer shelf         | Info/status section above the composer input                           | Full-page workflows              |
| Conversation decorator | Badge/indicator on a conversation list item                            | Interactive UI                   |
| Context menu           | Right-click menu item on message or sidebar item                       | Primary navigation               |
| Thread header action   | Compact button beside the Threads sidebar header                       | Wide/persistent workflows        |
| Status bar item        | Label in the status bar below the composer                             | Interactive controls             |
| Theme                  | Color theme via CSS variable tokens                                    | Layout or UI changes             |

Right-rail views may point at a paired workbench detail view with `detailView`:

```json
{
  "contributes": {
    "views": [
      {
        "id": "runs-rail",
        "title": "Runs",
        "location": "rightRail",
        "scope": "conversation",
        "component": "RunsRail",
        "detailView": "runs-detail"
      },
      {
        "id": "runs-detail",
        "title": "Run detail",
        "location": "workbench",
        "component": "RunsWorkbench"
      }
    ]
  }
}
```

## Keybindings

Extensions register shortcuts with `contributes.keybindings`. The manifest owns the default binding; the host owns listening, conflict handling, user remapping, and dispatch.

Supported host command targets include:

- `navigate:/path` — navigate to a route.
- `commandPalette:threads|files|commands|search` — open the command palette in a scope.
- `rightRail:{extensionId}/{surfaceId}` — open a right-rail extension surface.
- `layout:compact|workbench` — switch layout mode.

Do not install global `window` listeners for app-level shortcuts.

## Storage

Extensions should use app-owned document storage, scoped per extension:

```ts
await pa.storage.put('tasks/123', task, { expectedVersion });
const task = await pa.storage.get('tasks/123');
const tasks = await pa.storage.list('tasks/');
await pa.storage.delete('tasks/123');
```

Backend actions use `ctx.storage` against the same per-extension document store. One extension cannot read another extension's state unless a future shared-state API explicitly allows it.

## Trust and permissions

V1 native extensions are trusted local code. They are not sandboxed.

That is acceptable because Personal Agent already runs local agent tools with broad authority. The goal is not fake security theater; the goal is a clear contract and review surface.

Rules:

- Declare permissions in `extension.json`.
- Keep permissions aligned with what the extension can actually do.
- The Extension Manager displays permissions and should highlight permission expansion.
- Do not expose raw SQLite handles, Express routers, Electron main process objects, arbitrary app internals, or the full process environment as extension APIs.

## Packaging and import/export

Exported extensions should include the package root: manifest, source, package metadata, README, skills, and built `dist` output. Keep generated output available so imported extensions can run without archaeology.

If an imported extension needs rebuilding, its `package.json` must declare the dependencies needed for the build. Host-provided packages stay external; third-party runtime libraries belong in `dependencies`.

## References while building

Useful files to inspect when the schema or SDK shape matters:

- `packages/extensions/src/index.ts` — public SDK types.
- `packages/desktop/server/extensions/extensionManifest.ts` — manifest parsing/types.
- `packages/desktop/server/extensions/extensionRegistry.ts` — loading and registry behavior.
- `packages/desktop/server/extensions/extensionLifecycle.ts` — create/build/import/export lifecycle.
- `extensions/system-extension-manager/README.md` — product-level extension manager behavior.
- `extensions/system-*` — first-party examples using the same contract.

If the SDK lacks a host primitive needed by a first-party extension, add it deliberately to `packages/extensions` rather than importing app internals.
