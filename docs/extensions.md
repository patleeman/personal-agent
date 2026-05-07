# Extensions

Extensions are the planned self-extensibility layer for Personal Agent. They package UI surfaces, backend actions, storage, and commands so a user can ask the agent to create or modify local product functionality.

Apps proved the core idea: durable user-created UI can live outside the compiled desktop app. Extensions generalize that into a package model that can add pages, sidebar entries, right-rail tools, backend actions, and app-owned state.

This document is the target implementation spec for the first extension runtime, not an exploratory brainstorm.

## Goals

Extensions should make Personal Agent self-extensible without turning the core app into unstructured plugin soup.

A good extension system should let a user say:

> Create a kanban extension for agent tasks. Put it in the sidebar, persist tasks, and let cards start runs.

The agent should then create a local extension package with a manifest, UI files, backend handlers, storage, and docs. The user can inspect, edit, disable, or delete it.

## Package layout

User extensions live in runtime state by default, not the knowledge base. The knowledge base can still hold docs, exports, or generated source notes, but installed extension packages are runtime-owned product code.

Default user extension location:

```text
~/.local/state/personal-agent/extensions/{extension-id}/
```

Bundled system extensions live in the app/repo and are loaded by PA as first-party extensions. If the user or agent edits a system extension, PA creates a copy-on-write override in runtime state instead of mutating the bundled files.

A simple package looks like this:

```text
extensions/
  agent-board/
    extension.json
    README.md
    frontend/
      page.html
      rail.html
    backend/
      index.ts
```

The manifest is the contract between the extension and Personal Agent:

```json
{
  "schemaVersion": 1,
  "id": "agent-board",
  "name": "Agent Board",
  "packageType": "user",
  "description": "Kanban board for agent-executed tasks",
  "version": "0.1.0",
  "surfaces": [
    {
      "id": "nav",
      "placement": "left",
      "kind": "navItem",
      "label": "Agent Board",
      "icon": "kanban",
      "route": "/ext/agent-board"
    },
    {
      "id": "page",
      "placement": "main",
      "kind": "page",
      "route": "/ext/agent-board",
      "entry": "frontend/page.html"
    },
    {
      "id": "rail",
      "placement": "right",
      "kind": "toolPanel",
      "label": "Board",
      "icon": "kanban",
      "entry": "frontend/rail.html",
      "scope": "conversation"
    }
  ],
  "backend": {
    "entry": "backend/index.ts",
    "actions": [
      { "id": "createTaskFromConversation", "handler": "createTaskFromConversation" },
      { "id": "syncRunStatuses", "handler": "syncRunStatuses" }
    ]
  },
  "permissions": ["runs:read", "runs:start", "storage:readwrite", "conversations:read"]
}
```

For v0, permissions are declared and shown but not enforced. They are still useful because they document intent and make capability creep visible in diffs when the agent edits an extension.

## Manifest schema

The manifest schema is TypeScript-first. `packages/desktop/server/extensions/extensionManifest.ts` is the source of truth for placements, surface kinds, right-rail scopes, icon names, permissions, and the `ExtensionManifest` TypeScript type. Do not hand-maintain a parallel JSON Schema as the canonical contract; that creates drift, and drift is where bugs go to start a family.

Every manifest must include:

| Field           | Type   | Description                         |
| --------------- | ------ | ----------------------------------- |
| `schemaVersion` | `1`    | Manifest schema version             |
| `id`            | string | Stable extension ID; use kebab-case |
| `name`          | string | Display name                        |

Optional top-level fields:

| Field         | Type                 | Description                                           |
| ------------- | -------------------- | ----------------------------------------------------- |
| `packageType` | `'user' \| 'system'` | Extension source class; defaults to `user`            |
| `description` | string               | Short summary for the Extension Manager               |
| `version`     | string               | Extension package version                             |
| `surfaces`    | `ExtensionSurface[]` | UI/command/slash surfaces registered by the extension |
| `backend`     | `ExtensionBackend`   | Backend TypeScript entry and exported action handlers |
| `permissions` | string[]             | Declared capabilities; shown in v0, enforced later    |

The TypeScript definition below is embedded here so an agent can craft a valid manifest without spelunking through source files. Keep this section in sync with `extensionManifest.ts` when the schema changes:

```ts
export const EXTENSION_MANIFEST_VERSION = 1;

export const EXTENSION_PACKAGE_TYPES = ['user', 'system'] as const;
export type ExtensionPackageType = (typeof EXTENSION_PACKAGE_TYPES)[number];

export const EXTENSION_PLACEMENTS = ['left', 'main', 'right', 'conversation', 'command', 'slash'] as const;
export type ExtensionPlacement = (typeof EXTENSION_PLACEMENTS)[number];

export const EXTENSION_SURFACE_KINDS = ['navItem', 'navSection', 'page', 'toolPanel', 'inlineAction', 'command', 'slashCommand'] as const;
export type ExtensionSurfaceKind = (typeof EXTENSION_SURFACE_KINDS)[number];

export const EXTENSION_RIGHT_SURFACE_SCOPES = ['global', 'conversation', 'workspace', 'selection'] as const;
export type ExtensionRightSurfaceScope = (typeof EXTENSION_RIGHT_SURFACE_SCOPES)[number];

export const EXTENSION_SYSTEM_COMPONENT_KEYS = ['automations'] as const;
export type ExtensionSystemComponentKey = (typeof EXTENSION_SYSTEM_COMPONENT_KEYS)[number];

export const EXTENSION_ICON_NAMES = [
  'app',
  'automation',
  'browser',
  'database',
  'diff',
  'file',
  'gear',
  'graph',
  'kanban',
  'play',
  'sparkle',
  'terminal',
] as const;
export type ExtensionIconName = (typeof EXTENSION_ICON_NAMES)[number];

export const EXTENSION_PERMISSIONS = [
  'runs:read',
  'runs:start',
  'runs:cancel',
  'storage:read',
  'storage:write',
  'storage:readwrite',
  'vault:read',
  'vault:write',
  'vault:readwrite',
  'conversations:read',
  'conversations:write',
  'conversations:readwrite',
  'ui:notify',
] as const;
export type ExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number] | `${string}:${string}`;

export interface ExtensionManifest {
  schemaVersion: typeof EXTENSION_MANIFEST_VERSION;
  id: string;
  name: string;
  packageType?: ExtensionPackageType;
  description?: string;
  version?: string;
  surfaces?: ExtensionSurface[];
  backend?: ExtensionBackend;
  permissions?: ExtensionPermission[];
}

export type ExtensionSurface =
  | ExtensionLeftNavItemSurface
  | ExtensionLeftNavSectionSurface
  | ExtensionMainPageSurface
  | ExtensionRightToolPanelSurface
  | ExtensionConversationInlineActionSurface
  | ExtensionCommandSurface
  | ExtensionSlashCommandSurface;

interface ExtensionSurfaceBase {
  id: string;
  placement: ExtensionPlacement;
  kind: ExtensionSurfaceKind;
  title?: string;
  label?: string;
  icon?: ExtensionIconName;
  action?: string;
}

export interface ExtensionLeftNavItemSurface extends ExtensionSurfaceBase {
  placement: 'left';
  kind: 'navItem';
  label: string;
  route: string;
  icon?: ExtensionIconName;
  badgeAction?: string;
}

export interface ExtensionLeftNavSectionSurface extends ExtensionSurfaceBase {
  placement: 'left';
  kind: 'navSection';
  label: string;
  icon?: ExtensionIconName;
  items?: Array<{ label: string; route: string; icon?: ExtensionIconName; badgeAction?: string }>;
}

export interface ExtensionMainPageSurface extends ExtensionSurfaceBase {
  placement: 'main';
  kind: 'page';
  route: string;
  entry?: string;
  component?: ExtensionSystemComponentKey;
}

export interface ExtensionRightToolPanelSurface extends ExtensionSurfaceBase {
  placement: 'right';
  kind: 'toolPanel';
  label: string;
  entry: string;
  scope: ExtensionRightSurfaceScope;
  icon?: ExtensionIconName;
  defaultOpen?: boolean;
}

export interface ExtensionConversationInlineActionSurface extends ExtensionSurfaceBase {
  placement: 'conversation';
  kind: 'inlineAction';
  label: string;
  action: string;
  icon?: ExtensionIconName;
  when?: 'message' | 'selection' | 'composer';
}

export interface ExtensionCommandSurface extends ExtensionSurfaceBase {
  placement: 'command';
  kind: 'command';
  title: string;
  action: string;
  icon?: ExtensionIconName;
}

export interface ExtensionSlashCommandSurface extends ExtensionSurfaceBase {
  placement: 'slash';
  kind: 'slashCommand';
  name: string;
  description: string;
  action: string;
}

export interface ExtensionBackend {
  entry: string;
  actions?: ExtensionBackendAction[];
}

export interface ExtensionBackendAction {
  id: string;
  handler: string;
  title?: string;
  description?: string;
}
```

Agents should import or inspect this TypeScript schema instead of inventing new placements or icon names.

Runtime validation should be generated from the TypeScript source of truth. The intended flow is:

1. Define types and registries in `extensionManifest.ts`.
2. Generate JSON Schema for validating `extension.json` files.
3. Generate docs/snippets from the same constants where practical.
4. Export the public types from a future `@personal-agent/extensions` package.

Until schema generation exists, runtime validation can use a small manual validator backed by the exported constants. The manual validator is a bridge, not a second source of truth.

## Agent-readable registry and schema

The extension system needs first-class schema docs and runtime introspection so agents do not guess route names, icon names, placements, or existing extension IDs. These should be available in both human docs and machine-readable endpoints.

Expose the TypeScript schema and generated JSON Schema through the app docs. Extension authors can also use an emoji or inline SVG later, but named icons are the safe default for agent-created extensions.

Expose registry endpoints for agents and the Extension Manager:

```http
GET /api/extensions/schema          # placements, kinds, scopes, icon names
GET /api/extensions                 # enabled system + runtime extension manifests
GET /api/extensions/installed       # Extension Manager summaries: enabled state, manifest, permissions, routes, package path
GET /api/extensions/routes          # claimed routes and owning extension
GET /api/extensions/surfaces        # registered surfaces by placement/kind
GET /api/extensions/:id/files/*     # serve iframe assets from a runtime extension package
PATCH /api/extensions/:id           # enable/disable runtime extensions with { enabled: boolean }
```

The agent workflow for creating an extension should be:

1. Read `docs/extensions.md` and `packages/desktop/server/extensions/extensionManifest.ts`.
2. Call or inspect the extension registry to avoid route/surface collisions.
3. Pick icon names from the registry, not from vibes.
4. Create the package.
5. Ask PA to reload extensions. In the current skeleton, runtime manifests are read on demand; reload exists as the explicit API seam for the future cached TS backend loader.

## Lifecycle and package management

V0 supports two install paths:

1. The agent creates or edits files directly in `~/.local/state/personal-agent/extensions/{id}/`.
2. The user imports an extension zip bundle, which PA unpacks into the runtime extensions directory.

The Extension Manager lives at `/extensions` and supports the minimum operational lifecycle:

- list installed system and runtime extensions
- enable/disable runtime extensions; system extensions stay enabled in v0
- reload all extensions
- open a runtime extension folder in Finder from the desktop app
- show manifest, surfaces, routes, and declared permissions
- leave import/export extension bundles for the next package-management slice

Export bundles include extension code and manifest by default. Extension state export is optional and must be explicit so users do not accidentally move private task data, logs, or workflow history.

Agents edit runtime extension files directly. Before the extension-edit tool writes files, it must snapshot the current extension directory. Snapshots live under runtime state and are used for rollback/debugging; they are not a replacement for source control.

Reload is explicit, not file-watcher magic:

```http
POST /api/extensions/reload
POST /api/extensions/:id/reload
```

If a reload/build fails, PA keeps the previously loaded version active and reports the new error in the Extension Manager. Broken generated code should not brick the shell.

System extensions are bundled with PA. User edits create a runtime override:

```text
~/.local/state/personal-agent/extensions/_overrides/system/automations/
```

The override shadows the bundled system extension until disabled or removed.

## Surface model

Extensions add functionality by declaring surfaces. Placement and kind are separate so the UI model stays clear.

| Placement      | Purpose                                                 | Good examples                                                    |
| -------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| `left`         | Navigation and durable places                           | top-level nav items, extension sections, badges                  |
| `main`         | Full workflow pages                                     | Agent Board, Automations, Telemetry, Extension Manager           |
| `right`        | Contextual tools for the current conversation/workspace | file explorer, diffs, browser, artifacts, runs, board mini-panel |
| `conversation` | Inline transcript/composer affordances                  | task chips, custom message actions                               |
| `command`      | Command palette actions                                 | new task, open board, summarize into task                        |
| `slash`        | Composer slash commands                                 | `/task`, `/bugbash`, `/release-note`                             |

Surface IDs are unique inside one extension. Routes are globally unique. User extensions must use `/ext/{extensionId}/...` for main-page routes. Only bundled system extensions may claim built-in routes such as `/automations`. The loader should reject duplicate routes unless an extension is explicitly replacing a disabled extension or a system extension has an active copy-on-write override.

Left sidebar surfaces should be mostly declarative: labels, icons, routes, badges, and sections. The left bar is the app spine; arbitrary rendering there makes the whole app feel unstable.

Right rail surfaces can be richer. They are contextual, dismissible tools. File Explorer, Diffs, Browser, Apps, Artifacts, Runs, and custom board panels all fit here.

Main pages are for full workflows. A bundled system extension can own a normal PA page; a user extension can own `/ext/{id}` routes.

### Right rail scope

Right sidebar tools need an explicit scope because some panels are tied to the active conversation and some are global utilities. Add `scope` to right-side surfaces:

```ts
export type ExtensionRightSurfaceScope = 'global' | 'conversation' | 'workspace' | 'selection';
```

Examples:

```json
{
  "id": "board-rail",
  "placement": "right",
  "kind": "toolPanel",
  "scope": "global",
  "label": "Board",
  "entry": "frontend/rail.html"
}
```

```json
{
  "id": "conversation-task-panel",
  "placement": "right",
  "kind": "toolPanel",
  "scope": "conversation",
  "label": "Tasks",
  "entry": "frontend/conversation-tasks.html"
}
```

Conversation-scoped panels receive the active conversation ID in their launch context. Global panels do not. Workspace-scoped panels receive cwd/workspace metadata. Selection-scoped panels receive selected text/message/file context when opened.

## Commands and slash commands

Personal Agent does not yet have a full command palette, but the extension model should reserve the surface. Command registration should be manifest-first so commands can appear in a future palette, menus, and keyboard bindings.

```json
{
  "id": "new-task",
  "placement": "command",
  "kind": "command",
  "title": "Agent Board: New task",
  "action": "openNewTask"
}
```

Slash commands are separate because they live in the conversation composer and usually transform or submit text:

```json
{
  "id": "task",
  "placement": "slash",
  "kind": "slashCommand",
  "name": "task",
  "description": "Create an Agent Board task from the current prompt",
  "action": "createTaskFromPrompt"
}
```

The current implementation exposes manifest-declared command registrations through:

```http
GET /api/extensions/commands
GET /api/extensions/slash-commands
```

Those endpoints return enabled extension surfaces normalized into `{ extensionId, surfaceId, packageType, ... }` records. Slash-command registrations are currently loaded into the conversation composer slash menu and inserted as `/{name}` entries. They do not execute commands yet; command execution should call the registered backend `action` once the host invocation path is wired.

Slash actions should receive composer text, attachments, current conversation ID, cwd, and selected context. They can return one of: replace composer text, append context, open a modal, create a task, or submit a prompt.

## Frontend runtime

Extension frontend entries render in iframes by default. The iframe gives CSS and DOM isolation, so extension styles do not leak into the desktop shell.

Styling should be boring and reliable:

- PA injects a stable extension style library into the iframe, for example `/pa/extension.css`.
- The style library defines tokens, reset, typography, buttons, inputs, cards, tables, empty states, and layout helpers.
- Extensions can opt out or override locally, but generated extensions should start from the shared classes.
- The style library is versioned with PA and documented as a public extension API.
- Extension HTML should still be resilient if the shared CSS fails; self-contained critical layout is acceptable for generated apps.

Frontend entries receive a `window.PA` API plus launch context. Bundled system extensions may also render a registered React component through `component` instead of iframe HTML `entry`; user extensions should use iframe entries by default.

The v0 surface below is intentionally broader than apps because extensions need to behave like product modules:

```ts
PA.context.get() // extension id, surface id, route params, active conversation, cwd, theme

PA.run.start({ prompt, cwd?, source?, conversationId? })
PA.run.get(runId)
PA.run.list(filter?)
PA.run.subscribe(runId, handler)
PA.run.cancel(runId)

PA.storage.get(key)
PA.storage.put(key, value, { expectedVersion? })
PA.storage.delete(key)
PA.storage.list(prefix?)

PA.vault.read(path)
PA.vault.write(path, content)
PA.vault.list(path?)
PA.vault.search(query)
PA.vault.assetUrl(path)

PA.conversations.list()
PA.conversations.get(id, { tailBlocks? })
PA.conversations.getMeta(id)
PA.conversations.searchIndex(sessionIds)
// Target follow-up APIs: open, create, append

PA.automations.list()
PA.automations.get(taskId)
PA.automations.create(input)
PA.automations.update(taskId, input)
PA.automations.delete(taskId)
PA.automations.run(taskId)
PA.automations.readLog(taskId)
PA.automations.readSchedulerHealth()

PA.extension.invoke(actionId, input)
PA.extension.listCommands()
PA.extension.listSlashCommands()
// Target follow-up APIs: getManifest, listSurfaces

PA.ui.toast(message)
PA.ui.openSurface(surfaceId, params?)
PA.ui.closeSurface(surfaceId?)
PA.ui.setBadge(value)
PA.ui.setTitle(title)
PA.ui.confirm(options)
PA.ui.pickFile(options?)
PA.ui.pickDirectory(options?)

PA.events.subscribe(topic, handler)
PA.events.emit(topic, payload)
```

The app should avoid exposing raw desktop internals to iframe code. Frontend extensions should call stable PA APIs or custom backend actions.

## Backend actions

Backend code is a core part of the extension model. For v0, backend extensions are trusted local code: no sandboxing, no permission enforcement, but no direct import of PA internals as the public contract.

### Loading TypeScript without rebuilding PA

Extensions should not require rebuilding the desktop app. The extension host should load backend entries dynamically. For TypeScript, use an on-demand transpilation step into a runtime cache:

```text
extensions/agent-board/backend/index.ts
  -> ~/.local/state/personal-agent/extension-cache/agent-board/index.mjs
```

Implementation options:

- Use `esbuild` to bundle/transpile extension backend TS to ESM in the cache.
- In dev mode, load through `tsx` or an equivalent transpiler, but production should prefer a deterministic build cache.
- Track content hashes for `extension.json` and backend files. Rebuild only when changed.
- Import the cached module with a cache-busting URL query or unload/reload the extension host process.

Hot reload should be explicit and observable:

```http
POST /api/extensions/reload
POST /api/extensions/:id/reload
```

Reload behavior:

1. Re-scan manifests.
2. Rebuild changed backend entries.
3. Re-register surfaces/routes/actions.
4. Dispose old backend module if it exported `dispose(ctx)`.
5. Emit extension reload events to open iframes so they can refresh.

Ship a public types-only package for extension authors and agents:

```ts
import type { ExtensionBackendContext, ExtensionManifest } from '@personal-agent/extensions';
```

`@personal-agent/extensions` is the public type contract for manifests, surfaces, backend actions, and the backend context. The runtime still passes `ctx`; extensions should not import PA internals.

A backend module exports named async handlers:

```ts
export async function createTaskFromConversation(input, ctx) {
  const conversation = await ctx.conversations.get(input.conversationId);
  const task = {
    title: conversation.title ?? 'Untitled task',
    phase: 'backlog',
    conversationId: input.conversationId,
  };
  await ctx.storage.put(`tasks/${task.conversationId}`, task);
  return task;
}
```

The server invokes handlers through the action endpoint:

```http
POST /api/extensions/:extensionId/actions/:actionId
```

Current implementation transpiles runtime extension backend TypeScript with esbuild into `~/.local/state/personal-agent/extension-cache/{extensionId}/backend.mjs`, imports it with a cache-busting URL, and calls the manifest-declared handler. HTML extension pages get `/pa/client.js` injected automatically, so iframe code can call `PA.extension.invoke(actionId, input)`, `PA.storage.*`, `PA.runs.*`, `PA.vault.*`, `PA.conversations.*`, and `PA.automations.*`.

The backend context is the stable API for trusted extension code. The current implementation includes `ctx.storage`, `ctx.runs`, `ctx.automations`, `ctx.vault`, `ctx.conversations`, and `ctx.log`; the remaining namespaces below are the target surface for follow-up work:

```ts
ctx.storage.get(key)
ctx.storage.put(key, value, opts?)
ctx.storage.delete(key)
ctx.storage.list(prefix?)

ctx.runs.start({ prompt, cwd?, source? })
ctx.runs.get(runId)
ctx.runs.list(filter?)
ctx.runs.readLog(runId, tail?)
ctx.runs.cancel(runId)

ctx.conversations.list()
ctx.conversations.get(id, { tailBlocks? })
ctx.conversations.getMeta(id)
ctx.conversations.searchIndex(sessionIds)
// Target follow-up APIs: create, append

ctx.automations.list()
ctx.automations.get(taskId)
ctx.automations.create(input)
ctx.automations.update(taskId, input)
ctx.automations.delete(taskId)
ctx.automations.run(taskId)
ctx.automations.readLog(taskId)
ctx.automations.readSchedulerHealth()

ctx.vault.read(path)
ctx.vault.write(path, content)
ctx.vault.list(path?)
ctx.vault.search(query)

ctx.log.info(message, fields?)
ctx.log.warn(message, fields?)
ctx.log.error(message, fields?)

ctx.events.emit(topic, payload)
ctx.events.subscribe(topic, handler)

ctx.ui.notify(message, options?)
ctx.ui.setBadge(surfaceId, value)
```

Backend actions can also implement command and slash-command handlers. Those handlers receive typed input from the surface that invoked them.

Do not expose raw SQLite handles, Express routers, Electron main process objects, arbitrary PA internal modules, or the full process environment as the extension API. Trusted does not mean coupled to every private implementation detail.

## Storage

Extensions need app-owned state. The implemented model is server-side SQLite under Personal Agent runtime state, outside the knowledge base.

```text
~/.local/state/personal-agent/app-state/app-state.sqlite
```

Extension storage is per-extension by default. One extension cannot read another extension's storage through `PA.storage` or `ctx.storage` unless a future explicit shared-state API is added.

Expose document-style storage instead of raw SQL:

```http
GET    /api/extensions/:id/state/:key
PUT    /api/extensions/:id/state/:key       # body: { value, expectedVersion? }
DELETE /api/extensions/:id/state/:key
GET    /api/extensions/:id/state?prefix=tasks/
```

Iframe extensions can call the same API through `PA.storage.get/put/delete/list`. Backend actions use `ctx.storage` against the same per-extension SQLite documents.

A simple table is enough for v0:

```sql
CREATE TABLE extension_state (
  extension_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (extension_id, key)
);
```

Writes should support optimistic concurrency with `expectedVersion`. If the supplied version is stale, return `409 Conflict` with the current document.

The knowledge base is still useful, but not as the primary live-state DB. Use KB files for extension source, human-readable exports, docs, snapshots, and artifacts. Use runtime SQLite for interactive state like kanban tasks, run status indexes, and drag/drop positions.

## Sync direction

Do not sync raw SQLite files. Sync app-level documents or mutation events.

If extension state needs cross-device sync, add an append-only event table:

```sql
CREATE TABLE extension_state_events (
  event_id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL,
  key TEXT NOT NULL,
  op TEXT NOT NULL,
  value_json TEXT,
  base_version INTEGER,
  created_at INTEGER NOT NULL,
  device_id TEXT NOT NULL
);
```

Each mutation updates current state and appends an event in one transaction. Devices push/pull events and replay them locally. For kanban, each task should be its own document (`tasks/{id}`), with position-based ordering instead of rewriting one giant board array.

## Trust and permissions

The v0 trust model is pragmatic:

- Local/generated extensions are trusted code.
- Extension manifests declare permissions.
- Personal Agent displays permissions and warns when they expand.
- Permissions are not enforced in v0.
- No sandboxing for backend actions in v0.

This is not theater about stopping the local agent from touching files. The agent already has broad local capabilities. Permissions still matter as intent declaration, review aid, future sharing guardrail, and a foundation for eventual enforcement.

## Automations system extension target

Automations is the first implementation target. It should be a feature-equivalent bundled system extension that owns the existing `/automations` route.

The current server already exposes the necessary product capabilities through task routes:

```http
GET    /api/tasks
GET    /api/tasks/scheduler-health
POST   /api/tasks
GET    /api/tasks/:id
PATCH  /api/tasks/:id
DELETE /api/tasks/:id
GET    /api/tasks/:id/log
POST   /api/tasks/:id/run
```

The extension should not call those routes directly from backend code. Instead, the extension runtime should expose `ctx.automations` as a stable capability wrapping the current task service functions. The frontend should use `PA.automations` rather than scattering raw `/api/tasks` fetches across extension UI code.

The v0 Automations extension must support:

- list automations
- read scheduler health
- view automation detail
- create automation
- update automation
- delete automation
- run automation now
- read latest automation log
- preserve current conversation-thread binding behavior
- preserve current scheduler/activity/status information

This target is intentionally more demanding than a read-only dashboard. It proves that extensions can replace a real product page with frontend UI, backend capabilities, route ownership, and domain APIs.

## System extensions

Some built-in PA pages can become bundled system extensions once the runtime is solid. System extensions use the same manifest/surface model but ship with the app and can receive broader trusted APIs.

The first implementation target is a feature-equivalent Automations system extension. It owns the existing `/automations` route as a bundled system extension and uses the registered `automations` React component while the extension runtime grows iframe support for user extensions. It should use `PA.automations` / `ctx.automations` rather than direct imports or raw `/api/tasks` fetches.

Good later candidates:

- Apps / Extensions manager
- Telemetry
- Agent Board

Poor first candidates:

- Conversation transcript/composer
- Settings
- Knowledge editor
- Browser internals

The core shell should stay small and stable: navigation, layout, conversations, runs, auth/providers, app/extension registry, storage, and capability APIs.

## Migration from apps

The current `apps/{id}/APP.md + index.html` model can become a compatibility layer over extensions.

A current app:

```text
apps/agent-board/
  APP.md
  index.html
```

Can map to an extension manifest:

```json
{
  "schemaVersion": 1,
  "id": "agent-board",
  "name": "Agent Board",
  "surfaces": [{ "id": "page", "placement": "main", "kind": "page", "route": "/apps/agent-board", "entry": "index.html" }],
  "permissions": ["runs:start", "vault:readwrite"]
}
```

This keeps existing apps working while the product moves toward an extension manager.

## Recommended implementation path

1. Define `extension.json` schema, TypeScript types, icon registry, and introspection endpoints.
2. Add extension registry UI that lists installed local extensions, routes, surfaces, and declared permissions.
3. Support `main.page`, `left.nav`, and `right.toolPanel` surfaces, including right-panel scope.
4. Add stable `/pa/extension.css` styling library for iframe surfaces.
5. Add runtime SQLite-backed `PA.storage` / `ctx.storage`.
6. Add TypeScript backend action loading with explicit reload/hot-reload endpoints.
7. Add `PA.extension.call()` and backend action invocation.
8. Add command and slash-command registration, even before the full command palette exists.
9. Build the feature-equivalent Automations bundled system extension on the existing `/automations` route.
10. Add copy-on-write overrides for system extension edits.
11. Convert Agent Board into a user extension.
12. Convert Apps into the Extensions manager once the runtime proves itself.

The north star is a small trusted PA kernel surrounded by editable local extensions. Users should be able to create product features by talking to the agent, without every new workflow needing to land in the compiled desktop app.
