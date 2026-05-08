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

Bundled system extensions live in the repo/app bundle and use the same extension contract. System pages can move out of the core shell once the native runtime is stable.

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
    "skills": ["skills/agent-board/SKILL.md"],
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

- `id` is stable kebab-case and owns `/ext/{id}` routes.
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

`@personal-agent/extensions` should export optional primitives and hooks, for example:

```ts
Page;
Toolbar;
Button;
IconButton;
Form;
TextField;
Select;
List;
ListItem;
Detail;
EmptyState;
LoadingState;
ErrorState;
RunCard;
RunList;
useExtensionStorage;
useRuns;
useConversation;
```

These are the paved road, not a prison. If an extension needs a custom timeline, board, graph, or editor, it can build one with React and scoped CSS.

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

## Host APIs

Native extensions use a stable `pa` client object. The exact implementation lives in the app, but the public shape should be documented and typed through `@personal-agent/extensions`.

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

Backend actions receive equivalent capability namespaces through `ctx`.

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

| Contribution      | Purpose                                      |
| ----------------- | -------------------------------------------- |
| `views`           | Main pages and right-rail panels             |
| `nav`             | Left navigation items or sections            |
| `commands`        | Command palette actions                      |
| `slashCommands`   | Composer slash commands                      |
| `settings`        | Extension settings shown in the app settings |
| `skills`          | Agent skills bundled with the extension      |
| `backend.actions` | Trusted local handlers callable by surfaces  |

Main pages are durable workflows. User extensions should use `/ext/{extensionId}` routes. System extensions may own first-party routes such as `/automations`.

Right-rail panels are contextual tools. They need scope:

```ts
type RightRailScope = 'global' | 'conversation' | 'workspace' | 'selection';
```

Conversation-scoped panels receive `conversationId`. Workspace-scoped panels receive cwd/workspace context. Selection-scoped panels receive selection context when opened.

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
- `system-runs` owns the conversation right-rail Runs surface while durable run execution remains core infrastructure.
- `system-diffs` owns the conversation right-rail Diffs surface while workspace/checkpoint diff APIs remain core infrastructure.
- `system-settings` owns deep links for first-party settings subpanels while settings persistence remains core infrastructure.

This is the preferred split: core records and serves cross-cutting state; native extensions own the product surfaces.

Extension Manager can build runtime extensions in-app. Use the per-extension **Build** action to compile `src/frontend.tsx` and `src/backend.ts` into manifest-declared `dist/*` entries, then **Reload** to refresh backend modules and registry surfaces.

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
