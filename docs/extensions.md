# Extensions

Extensions are Personal Agent's native product-module system. They let Patrick or an agent add app functionality without editing the core shell for every new workflow.

The old iframe/HTML extension model is deprecated and should be removed. New extensions render native React inside the Personal Agent UI, declare their surfaces in a manifest, call stable PA capabilities, and use separate frontend/backend entries.

## Design direction

Personal Agent should feel like one app, not a pile of embedded mini-sites. The extension system follows the VS Code/Raycast pattern:

- A manifest declares discoverable contributions: pages, nav items, right-rail panels, commands, slash commands, settings, skills, and backend actions.
- A frontend bundle exports native React surface components loaded lazily by the desktop UI.
- Backend actions run as trusted local Node/TypeScript code behind capability-scoped APIs.
- Extension CSS is allowed, but it is mounted under a host-provided extension root with reset boundaries and cascade layers so it does not casually poison the shell.
- Webview/iframe surfaces are not the product path. Do not create new iframe extensions.

The north star is simple: an agent should be able to create a real native feature by generating an extension package, building it, and reloading Personal Agent.

## Package layout

User extensions live in runtime state by default:

```text
~/.local/state/personal-agent/extensions/{extension-id}/
```

The extension loader also accepts arbitrary package roots or directories of packages through `PERSONAL_AGENT_EXTENSION_PATHS` (comma-separated or colon-separated). Each entry can point directly at a folder with `extension.json`, or at a parent folder containing many extension packages.

Bundled first-party extensions live in the repo/app bundle under `extensions/` and use the same extension contract. They are discovered by the same package-path scanner as user extensions; there is no hard-coded system extension allowlist. First-party product areas should live there too: automations, artifacts, browser, diffs, file explorer, gateways, images, knowledge, runs, settings panels, telemetry, web tools, and the extension manager itself.

A native extension package looks like this:

```text
extensions/
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

Agents should generate editable source files, run the PA-owned extension build, and keep built `dist/` output available for runtime loading. Do not generate dist-only extensions; compiled soup is where maintainability goes to die.

## Manifest

`extension.json` is the readable contract. The app can inspect it without executing extension code, which keeps routing, command registration, permissions, and extension management predictable.

Example:

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
    "actions": [
      { "id": "createTask", "handler": "createTask", "title": "Create task" },
      { "id": "startTaskRun", "handler": "startTaskRun", "title": "Start task run" }
    ]
  },
  "contributes": {
    "skills": [
      {
        "id": "agent-board",
        "title": "Agent Board",
        "description": "Use when planning or executing Agent Board tasks.",
        "path": "skills/agent-board/SKILL.md"
      }
    ],
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
    ],
    "views": [
      {
        "id": "board-page",
        "title": "Agent Board",
        "location": "main",
        "route": "/ext/agent-board",
        "component": "AgentBoardPage"
      },
      {
        "id": "conversation-board",
        "title": "Tasks",
        "location": "rightRail",
        "scope": "conversation",
        "component": "ConversationTaskPanel"
      }
    ],
    "nav": [
      {
        "id": "agent-board-nav",
        "label": "Agent Board",
        "icon": "kanban",
        "route": "/ext/agent-board"
      }
    ],
    "commands": [
      {
        "id": "agentBoard.createTask",
        "title": "Agent Board: Create task",
        "action": "createTask"
      }
    ],
    "slashCommands": [
      {
        "name": "task",
        "description": "Create an Agent Board task from the current prompt.",
        "action": "createTask"
      }
    ]
  },
  "permissions": ["runs:read", "runs:start", "storage:readwrite", "conversations:read"]
}
```

Manifest rules:

- `id` is stable kebab-case. Routes are explicit manifest contributions; use `/ext/{id}` by convention for user extensions, but the runtime can host extension pages at any route not already claimed by the core shell.
- The manifest declares what exists; code implements behavior.
- Renderable views declare the frontend bundle and exported component name explicitly.
- Backend actions declare stable action IDs and exported handler names.
- Permissions are required as intent declarations even before strict enforcement exists.

## Frontend runtime

Native frontend extensions are React modules rendered inside the Personal Agent React tree.

The extension frontend bundle exports named components referenced by manifest views:

```tsx
import { Button, EmptyState, Page, Toolbar, type ExtensionSurfaceProps } from '@personal-agent/extensions';
import './styles.css';

export function AgentBoardPage({ pa, context }: ExtensionSurfaceProps) {
  return (
    <Page title="Agent Board" summary="Track work that agents can execute.">
      <Toolbar>
        <Button
          onClick={() =>
            pa.extension.invoke('createTask', {
              source: 'manual',
              conversationId: context.conversationId,
            })
          }
        >
          New task
        </Button>
      </Toolbar>
      <EmptyState title="No tasks yet" body="Create a task from a conversation or start one here." />
    </Page>
  );
}
```

Surface components receive props instead of reading globals:

```ts
interface ExtensionSurfaceProps<Params = Record<string, string>> {
  pa: PersonalAgentClient;
  context: ExtensionRenderContext;
  surface: ExtensionViewContribution;
  params: Params;
}
```

Use props for testability and clarity. Do not use `window.PA` in native extensions.

### UI freedom and guardrails

Extensions may use normal React and CSS. They are not forced to use PA components.

That freedom comes with host-level guardrails:

- Every extension renders under a host root such as `<section data-extension-id="agent-board">`.
- The host applies an extension reset boundary so extension styles start from predictable defaults.
- Extension styles load into an extension-specific cascade layer.
- PA theme tokens are available as CSS variables.
- The extension manager should show when an extension ships global-looking CSS selectors.

Recommended path: use PA components for common UI and custom CSS for product-specific layout.

`@personal-agent/extensions` exports stable public types such as `ExtensionSurfaceProps` and the native `pa` client shape. Host-provided frontend primitives are split into namespaces so extension code does not import from app internals:

```ts
import type { ExtensionSurfaceProps, NativeExtensionClient } from '@personal-agent/extensions';
import { AppPageLayout, EmptyState, ToolbarButton } from '@personal-agent/extensions/ui';
import { api, useAppData, timeAgo } from '@personal-agent/extensions/data';
import { WorkbenchBrowserTab, WorkspaceExplorer } from '@personal-agent/extensions/workbench';
import { SettingsPage } from '@personal-agent/extensions/settings';
```

These namespaces are the paved road, not a prison. If an extension needs a custom timeline, board, graph, or editor, it can build one with React and scoped CSS. If a first-party extension needs a new primitive, add it deliberately to one of these namespaces instead of importing from `packages/desktop/ui/src/...`.

## Build and loading

Personal Agent owns the extension build command. Extension authors should not need custom Vite configs for normal packages.

Target command from the repo:

```bash
npm run extension:build -- ~/.local/state/personal-agent/extensions/agent-board
```

A future packaged desktop UI can expose this through the Extension Manager, but there is no standalone `pa` CLI anymore.

The builder should:

1. Compile `src/frontend.tsx` to `dist/frontend.js`.
2. Extract or bundle extension CSS to `dist/frontend.css`.
3. Compile `src/backend.ts` to `dist/backend.mjs`.
4. Bundle extension dependencies into the output, except host peer packages.
5. Treat `react`, `react-dom`, and `@personal-agent/extensions` as host-provided peers.
6. Produce a clear build error that the agent can fix.

The desktop UI lazy-loads frontend bundles when a declared surface is opened or command UI is needed. It should not execute every extension at startup.

Lazy activation triggers:

- Open a route owned by an extension view.
- Open a right-rail surface.
- Invoke an extension command or slash command.
- Run a backend action.
- Load extension settings/details in the Extension Manager.

## Backend runtime

Backend entries are separate from frontend entries. Keep browser React code and Node capability code apart; shared code can live in a common module if needed.

A backend module exports named handlers declared in the manifest:

```ts
import type { ExtensionBackendContext } from '@personal-agent/extensions';

export async function createTask(input: { title?: string; conversationId?: string }, ctx: ExtensionBackendContext) {
  const id = crypto.randomUUID();
  const task = {
    id,
    title: input.title || 'Untitled task',
    status: 'backlog',
    conversationId: input.conversationId ?? null,
    createdAt: new Date().toISOString(),
  };

  await ctx.storage.put(`tasks/${id}`, task);
  return task;
}

export async function startTaskRun(input: { taskId: string }, ctx: ExtensionBackendContext) {
  const task = await ctx.storage.get<{ title: string }>(`tasks/${input.taskId}`);
  if (!task) throw new Error('Task not found');

  return ctx.runs.start({
    taskSlug: 'agent-board',
    prompt: `Work this task: ${task.title}`,
    source: 'extension:agent-board',
  });
}
```

Frontend code calls backend actions through the host seam:

```ts
await pa.extension.invoke('startTaskRun', { taskId });
```

Do not import backend handlers directly into frontend components. Browser/Node boundary lies are expensive and stupid.

## Agent skills and tools

Extensions can contribute agent skills and agent tools. These are runtime-mounted from the enabled extension package; they are not copied into the knowledge vault.

### Skills

Use extension skills for local instructions that explain how to use the extension, its tools, or its domain model. A skill lives in the extension folder and resolves relative references against that skill folder.

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

Runtime behavior:

- Enabled extension skills are passed to the agent as normal skill directories.
- Disabled extension skills disappear immediately after extension reload / new agent startup.
- Skill IDs are presented as extension-owned context; package authors should keep IDs stable and short.
- Do not copy extension skills into the vault. The extension owns its internal context.

### Tools

Use extension tools when the agent needs executable runtime behavior backed by extension code. Tool handlers run in the backend extension entry, not in frontend React.

```json
{
  "backend": { "entry": "src/backend.ts" },
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

The runtime registers the tool with a stable generated name: `extension_{extensionId}_{toolId}` with non-identifier characters normalized to underscores. The manifest `action` points to the backend action/handler invoked with the tool input.

Backend example:

```ts
export async function createTask(input: { title: string }, ctx: ExtensionBackendContext) {
  const id = crypto.randomUUID();
  await ctx.storage.put(`tasks/${id}`, { id, title: input.title, status: 'backlog' });
  return { id };
}
```

Rules:

- Agent-visible tools require a description and JSON-schema-like `inputSchema`.
- Tool handlers are backend-only; frontend code can call the same backend action through `pa.extension.invoke`.
- Permissions are declared at the extension level and should match what the tool can do.
- Keep tools coarse enough to be useful. Do not expose every button click as an agent tool.

Bundled system extensions own these current tool families:

- Web tools: `web_fetch`, `web_search`.
- Artifacts: `artifact`.
- Automations: `scheduled_task`, `conversation_queue`, `reminder`.
- Runs: `run`.
- Diffs/checkpoints: `checkpoint`.
- Images: `image`, `probe_image`.

Core still owns shell/file editing primitives, MCP until secret storage is improved, and a few conversation-control tools that are tightly coupled to live session lifecycle.

## Host APIs

Native extensions use a stable `pa` client object. The exact implementation lives in the app, but the public shape is typed through `@personal-agent/extensions`.

Implemented frontend namespaces today:

- `pa.extension`: invoke backend actions and inspect the current extension.
- `pa.automations`: list, save, delete, run, and inspect scheduled tasks.
- `pa.runs`: start, list, inspect, read logs, and cancel durable runs.
- `pa.storage`: per-extension document storage.
- `pa.workspace`: tree, file read/write, create/delete/rename/move, and diffs for arbitrary user-selected paths.
- `pa.workbench`: store lightweight detail state for paired right-rail/workbench surfaces.
- `pa.browser`: control the desktop workbench browser.
- `pa.ui`: toast and confirm helpers.

Target namespaces:

```ts
pa.extension.invoke(actionId, input)
pa.extension.getManifest()
pa.extension.listSurfaces()

pa.storage.get(key)
pa.storage.put(key, value, { expectedVersion? })
pa.storage.delete(key)
pa.storage.list(prefix?)

pa.runs.start(input)
pa.runs.get(runId)
pa.runs.list(filter?)
pa.runs.readLog(runId, tail?)
pa.runs.cancel(runId)

pa.conversations.list()
pa.conversations.get(id, options?)
pa.conversations.getMeta(id)
pa.conversations.search(query)

pa.vault.read(path)
pa.vault.write(path, content)
pa.vault.list(path?)
pa.vault.search(query)

pa.workspace.readText({ cwd, path })
pa.workspace.writeText({ cwd, path, content })
pa.workspace.list({ cwd, path?, depth? })

pa.git.status({ cwd })
pa.git.diff({ cwd, path?, staged? })
pa.git.log({ cwd, maxCount? })

pa.shell.exec({ command, args?, cwd?, timeoutMs?, env? })

pa.automations.list()
pa.automations.get(taskId)
pa.automations.create(input)
pa.automations.update(taskId, input)
pa.automations.delete(taskId)
pa.automations.run(taskId)
pa.automations.readLog(taskId)
pa.automations.readSchedulerHealth()

pa.ui.toast(message, options?)
pa.ui.confirm(options)
pa.ui.openSurface(surfaceId, params?)
pa.ui.closeSurface(surfaceId?)
pa.ui.setBadge(surfaceId, value)
```

Backend actions receive equivalent capability namespaces through `ctx`. Backend-only capabilities currently include `ctx.workspace`, `ctx.git`, and `ctx.shell`; frontend should call backend actions rather than shelling out directly.

Do not expose raw SQLite handles, Express routers, Electron main process objects, arbitrary app internals, or the full process environment as the extension API.

## Storage

Extensions need app-owned state. Use runtime SQLite under Personal Agent state, scoped per extension.

```text
~/.local/state/personal-agent/app-state/app-state.sqlite
```

Expose document-style storage, not raw SQL:

```ts
pa.storage.get('tasks/123');
pa.storage.put('tasks/123', task, { expectedVersion });
pa.storage.list('tasks/');
pa.storage.delete('tasks/123');
```

Backend actions use `ctx.storage` against the same per-extension document store.

Each extension is isolated by default. One extension cannot read another extension's state unless a future shared-state API explicitly allows it.

## Trust and permissions

V1 native extensions are trusted local code. They are not sandboxed.

That is acceptable because Personal Agent already runs local agent tools with broad authority. The goal is not fake security theater; the goal is a clear contract and review surface.

Rules:

- Extensions declare permissions in `extension.json`.
- The Extension Manager displays permissions and highlights permission expansion in diffs/edits.
- Runtime APIs should be shaped so permissions can be enforced later.
- User-installed extensions should be inspectable, disableable, exportable, and removable.
- Backend code runs locally and should be treated like any other trusted script.

## Surfaces

Extensions contribute native surfaces through the manifest.

| Contribution      | Purpose                                       |
| ----------------- | --------------------------------------------- |
| `views`           | Main pages and right-rail panels              |
| `nav`             | Left navigation items or sections             |
| `commands`        | Command palette actions                       |
| `slashCommands`   | Composer slash commands                       |
| `settings`        | Extension settings shown in the app settings  |
| `skills`          | Agent skills bundled with the extension       |
| `tools`           | Agent-visible tools backed by backend actions |
| `backend.actions` | Trusted local handlers callable by surfaces   |

### Surface selection

Pick the smallest surface that matches the product shape. Do not use the right rail as a junk drawer. That path gets ugly fast.

| Surface               | Use for                                                                            | Do not use for                                                     | Examples                              |
| --------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| Main page view        | Durable app-level workflows with their own route and enough room to work           | Tiny contextual helpers or per-conversation detail panes           | Automations, Gateways, Telemetry      |
| Left nav item         | Primary destinations users should see every day                                    | Settings subpanels, secondary tools, or disabled/hidden extensions | Automations, Gateways, Telemetry      |
| Right-rail panel      | Compact contextual companions for the active conversation, workspace, or selection | Wide editors, diff/log viewers, or large previews                  | Knowledge browser, artifact list      |
| Workbench detail view | Large detail rendering paired to a right-rail selector                             | Standalone app-level workflows                                     | Run logs, diff viewers, file previews |
| Settings contribution | Configuration and preferences under `/settings/*`                                  | Product workflows or top-level navigation                          | Provider, dictation, desktop settings |
| Command               | Fast one-shot actions or ways to open a surface                                    | Long-running UI that needs persistent screen space                 | Build extension, reload extensions    |
| Slash command         | Conversation-authored actions that produce or alter prompt context                 | Global app navigation or settings                                  | Insert prompt, attach context         |

Main pages are durable workflows. `/ext/{extensionId}` is the recommended user-extension convention, but it is not a sandbox. Extension page routes are manifest-owned and may use any unclaimed app path.

Right-rail panels are contextual tools. They need scope:

```ts
type RightRailScope = 'global' | 'conversation' | 'workspace' | 'selection';
```

Conversation-scoped panels receive `conversationId`. Workspace-scoped panels receive cwd/workspace context. Selection-scoped panels receive selection context when opened.

If a feature needs a selector/list plus a large detail renderer, use a right-rail view with `detailView` pointing at a paired `location: "workbench"` view. The rail chooses the target; the workbench view renders the large detail pane. Runs, Diffs, File Explorer, Knowledge, Artifacts, and Browser are the model shape: rail selection on the right, logs/diffs/files/knowledge/artifacts/browser detail in the center.

The frontend client exposes host-owned primitives for richer workbench surfaces:

```ts
pa.workbench.getDetailState(surfaceId)
pa.workbench.setDetailState(surfaceId, state)
pa.browser.isAvailable()
pa.browser.open({ url, tabId? })
pa.browser.getState({ tabId? })
pa.browser.goBack({ tabId? })
pa.browser.goForward({ tabId? })
pa.browser.reload({ tabId? })
pa.browser.stop({ tabId? })
pa.browser.snapshot({ tabId? })
```

Browser primitives intentionally hide Electron bounds and desktop bridge details. Extensions request browser actions; the host owns the embedded browser lifecycle and layout.

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

## Extension Manager

The Extension Manager should support the operational lifecycle:

- list installed system and user extensions
- show manifest, surfaces, commands, routes, build status, and permissions
- create a starter native extension package
- build/rebuild an extension
- reload extension registry/runtime
- enable/disable user extensions
- export/import extension packages
- snapshot a user extension before agent edits
- open an extension folder in Finder/editor
- show build/runtime errors in a way the agent can fix

## Agent workflow

When asked to create or modify an extension, agents should:

1. Read this document and inspect the current extension schema/types.
2. Inspect existing extension IDs, routes, surfaces, and commands to avoid collisions.
3. Create or edit source files under the runtime extension package.
4. Prefer PA components for common UI, custom CSS for genuinely custom layout.
5. Declare permissions and contributions explicitly in `extension.json`.
6. Run `npm run extension:build -- <extension-dir>` from the repo, or use the Extension Manager **Build** action.
7. Reload extensions.
8. Visually inspect the native surface.
9. Snapshot/checkpoint only the files touched.

Do not create new iframe `frontend/*.html` surfaces. If old iframe extension files remain during migration, treat them as legacy code to replace, not examples to copy.

## Migration from iframe extensions

The iframe extension runtime was useful as a prototype but is the wrong long-term substrate. It creates a mini-app inside the app, with separate DOM, styling, focus, routing, and communication problems.

Hard-pivot migration target:

1. Implement native frontend bundle loading.
2. Add manifest schema v2 with `frontend.entry`, `frontend.styles`, and component-based view contributions.
3. Replace `ExtensionFrame` with native `ExtensionSurfaceHost`.
4. Migrate `system-automations` from `frontend/index.html` to native React exports.
5. Remove iframe file-serving/injection paths for extension UI.
6. Keep artifacts as iframe/rendered outputs where appropriate; artifacts are not extensions.
7. Update starter package generation to create native source, not HTML templates.
8. Delete or archive `docs/extension-templates/*.html` after native starters exist.

Artifacts remain the sketchpad for generated reports, previews, and custom throwaway UI. Extensions are native product modules.

## Migrated system extensions

The first native system extensions are:

- `system-automations` owns `/automations` and scheduled/conversation-bound automation UI.
- `system-gateways` owns `/gateways` while the core app keeps gateway state and APIs.
- `system-telemetry` owns `/telemetry` while telemetry collection remains core infrastructure.
- `system-files` owns the workspace File Explorer rail and paired workbench file detail view while workspace filesystem APIs remain core infrastructure.
- `system-diffs` owns the conversation Diffs rail and paired workbench detail view while checkpoint persistence remains core infrastructure.
- `system-runs` owns the conversation Runs rail and paired workbench detail view while durable run execution remains core infrastructure.
- `system-settings` owns deep links for first-party settings subpanels while settings persistence remains core infrastructure.

This is the preferred split: core records and serves cross-cutting state; native extensions own the product surfaces.

Extension Manager can build runtime extensions in-app. Use the per-extension **Build** action to compile `src/frontend.tsx` and `src/backend.ts` into manifest-declared `dist/*` entries, then **Reload** to refresh backend modules and registry surfaces. Starter creation supports three templates: `main-page`, `right-rail`, and `workbench-detail`.

## Implementation checklist

Target order:

1. Add manifest schema v2 and public types in `@personal-agent/extensions`.
2. Build `npm run extension:build -- <extension-dir>` for frontend/backend bundles.
3. Add native `ExtensionSurfaceHost` with lazy dynamic import.
4. Add scoped CSS loading with extension root, reset boundary, theme tokens, and cascade layer.
5. Add typed `pa` surface props and optional PA UI components/hooks.
6. Wire manifest `views`, `nav`, commands, and slash commands to native components/actions.
7. Migrate system product surfaces to native extensions.
8. Remove iframe extension UI runtime and starter HTML templates.
9. Update Extension Manager for native build/reload/status flows.
10. Backfill tests around manifest parsing, lazy loading, action invocation, CSS scoping, and system extension migrations.
