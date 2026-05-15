# Extension Authoring Guide

Extensions add capabilities to the Personal Agent desktop app. This guide
covers how to create, structure, and publish extensions.

## Contents

- [Core vs extensions](#core-vs-extensions)
- [Extension Structure](#extension-structure)
- [Manifest (`extension.json`)](#manifest-extensionjson)
- [Frontend (UI)](#frontend-ui)
- [Main page layout](#main-page-layout)
- [Styling guidance](#styling-guidance)
- [Backend (Server-side)](#backend-server-side)
- [Agent Lifecycle Hooks](#agent-lifecycle-hooks)
- [Conversation Write API](#conversation-write-api)
- [Inter-extension Communication](#inter-extension-communication)
- [Notifications and Badge](#notifications-and-badge)
- [Permissions](#permissions)
- [Development Workflow](#development-workflow)
- [Examples](#examples)

## Core vs extensions

Personal Agent core is the small, stable platform: agent and conversation runtime, model/tool execution protocol, transcript/event stream, durable storage primitives, knowledge/system-prompt assembly, extension host/manifest/API/permissions, security boundaries, desktop/web shell, routing, install/update plumbing, and shared UI primitives.

Everything user-facing, domain-specific, or workflow-specific should be an extension: pages, panels, tool renderers, slash/command surfaces, integrations, context providers, automations, import/export flows, diagnostics views, settings sections, and opinionated UX built on top of the platform.

When a feature cannot be built cleanly as an extension, add a general-purpose extension API or SDK primitive to core rather than hardcoding a one-off app feature. Core should make features possible; extensions should be where features live.

## Extension Structure

A minimal extension looks like:

```
my-extension/
├── extension.json      # Manifest
├── package.json        # Dependencies (optional)
├── src/
│   ├── frontend.tsx    # UI components (optional)
│   └── backend.ts      # Backend handlers / protocol entrypoints (optional)
└── dist/               # Built output
```

Create a new extension with:

```bash
POST /api/extensions
{
  "id": "my-ext",
  "name": "My Extension",
  "template": "main-page"   # "main-page", "right-rail", or "workbench-detail"
}
```

## Manifest (`extension.json`)

The manifest declares what your extension contributes:

```json
{
  "schemaVersion": 2,
  "id": "my-extension",
  "name": "My Extension",
  "description": "What it does",
  "version": "0.1.0",
  "packageType": "user",
  "permissions": ["storage:readwrite"],
  "frontend": {
    "entry": "dist/frontend.js",
    "styles": []
  },
  "backend": {
    "entry": "src/backend.ts",
    "actions": [
      {
        "id": "ping",
        "handler": "ping",
        "title": "Ping"
      }
    ],
    "protocolEntrypoints": [
      {
        "id": "acp",
        "handler": "runAcpProtocol",
        "title": "Agent Client Protocol"
      }
    ]
  },
  "contributes": {
    "views": [],
    "nav": [],
    "commands": [],
    "tools": [],
    "skills": [],
    "themes": []
  }
}
```

**`packageType`**: `"user"` (your own extension) or `"system"` (bundled with the app).

**`defaultEnabled`**: set to `false` for experimental extensions that should ship installed but disabled until the user explicitly enables them.

**`permissions`**: See [Permissions](#permissions).

### Contribution Types

| Field                         | Purpose                                                     | Docs                                                                                      |
| ----------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `views`                       | UI surfaces (pages, panels)                                 | See `docs/views.md`                                                                       |
| `nav`                         | Left sidebar navigation items                               |                                                                                           |
| `commands`                    | Extension actions invokable by command IDs                  | See [Commands and keybindings](../packages/extensions/README.md#commands-and-keybindings) |
| `keybindings`                 | Keyboard shortcuts that execute commands                    | See [Commands and keybindings](../packages/extensions/README.md#commands-and-keybindings) |
| `slashCommands`               | `/command` in composer                                      |                                                                                           |
| `tools`                       | Agent-callable tools                                        |                                                                                           |
| `mentions`                    | @-mention providers                                         |                                                                                           |
| `skills`                      | Agent Skills (markdown)                                     |                                                                                           |
| `themes`                      | Color themes                                                |                                                                                           |
| `backend.protocolEntrypoints` | Extension-owned stdio protocols launched by the host CLI    | [See below](#protocol-entrypoints-backendprotocolentrypoints)                             |
| `transcriptRenderers`         | Custom tool result rendering                                |                                                                                           |
| `promptReferences`            | @-mention resolvers                                         |                                                                                           |
| `quickOpen`                   | Command palette surfaces/tabs backed by extension providers | [See below](#quick-open-surfaces-quickopen)                                               |
| `settings`                    | Settings schema contributions                               | [See below](#settings)                                                                    |
| `settingsComponent`           | Component panel in Settings                                 | [See below](#settings-component-settingscomponent)                                        |
| `topBarElements`              | Top bar indicator icons                                     | [See below](#top-bar-elements-topbarelements)                                             |
| `conversationHeaderElements`  | Badges in conversation header                               | [See below](#conversation-header-elements-conversationheaderelements)                     |
| `messageActions`              | Hover buttons on messages                                   | [See below](#message-actions-messageactions)                                              |
| `composerShelves`             | Sections above the composer                                 | [See below](#composer-shelves-composershelves)                                            |
| `newConversationPanels`       | Panels on the new conversation page                         | [See below](#new-conversation-panels-newconversationpanels)                               |
| `composerControls`            | Component controls in the composer bottom row               | [See below](#composer-controls-composercontrols)                                          |
| `composerButtons`             | Legacy composer controls                                    | [See below](#composer-buttons-composerbuttons)                                            |
| `composerInputTools`          | Component tools beside composer controls                    | [See below](#composer-input-tools-composerinputtools)                                     |
| `toolbarActions`              | Icon buttons in composer toolbar                            | [See below](#toolbar-actions-toolbaractions)                                              |
| `conversationDecorators`      | Badges on conversation list items                           | [See below](#conversation-decorators-conversationdecorators)                              |
| `contextMenus`                | Right-click menu items                                      | [See below](#context-menus-contextmenus)                                                  |
| `threadHeaderActions`         | Component buttons in the Threads header                     | [See below](#thread-header-actions-threadheaderactions)                                   |
| `statusBarItems`              | Labels in the composer status bar                           | [See below](#status-bar-items-statusbaritems)                                             |

### Views

Views are the primary way to add UI. Three locations:

- **`main`**: Full-page view at a custom route (`/ext/your-id`).
- **`rightRail`**: Collapsible panel beside the conversation.
- **`workbench`**: Center detail pane, paired with a right rail view.

```json
{
  "id": "my-panel",
  "title": "My Panel",
  "location": "rightRail",
  "component": "MyComponent",
  "scope": "conversation",
  "icon": "app",
  "activation": "on-open"
}
```

**`activation`** controls when the component loads:

- `"on-route"` — loads when the route is active (for main pages).
- `"on-open"` — loads when the user opens the panel.
- `"on-demand"` — loads lazily when needed.
- `"always"` — always mounted.

**`scope`** for rightRail views:

- `"conversation"` — one instance per conversation.
- `"workspace"` — one per workspace/cwd.
- `"global"` — single instance.

### Message Actions (`messageActions`)

Add hover-reveal text buttons on messages, inline with copy/fork/rewind.
Action-based — no frontend entry needed.

```json
{
  "id": "summarize-message",
  "title": "Summarize",
  "action": "summarizeHandler",
  "when": "role:assistant && hasText",
  "priority": 10
}
```

**`when`** predicates:

- `role:assistant` — only on assistant messages
- `role:user` — only on user messages
- `hasText` — message has text content

Backend handler receives:

```typescript
{
  messageText: string;
  messageRole: 'user' | 'assistant';
  blockId: string;
  conversationId: string;
}
```

### Slash Commands (`slashCommands`)

Add `/command` entries to the conversation composer. Slash commands are listed in the composer slash menu and execute an extension backend action before the prompt is sent.

```json
{
  "backend": {
    "entry": "dist/backend.mjs",
    "actions": [{ "id": "createTask", "handler": "createTask" }]
  },
  "contributes": {
    "slashCommands": [
      {
        "name": "task",
        "description": "Create a task from composer input.",
        "action": "createTask"
      }
    ]
  }
}
```

The backend action receives:

```typescript
{
  commandName: string;
  argument: string;
  text: string;
  conversationId: string | null;
  cwd: string;
  draft: boolean;
}
```

The action can return a string, `{ prompt }`, or `{ text }` to send a generated prompt; `{ replaceComposerText }` or `{ appendComposerText }` to update the composer without sending; `{ notice: { text, tone } }` to show feedback; or any other object/empty result to mark the command handled.

Use `slashCommands` for composer-triggered extension code. Use `pi.registerCommand(...)` inside `backend.agentExtension` only when the command must run inside the live agent session runtime; that does not automatically make the command appear in the composer slash menu.

### Quick-open surfaces (`quickOpen`)

Add a top-level tab to the command palette. Each quick-open contribution registers one extension-owned surface.
The palette uses `section` as the stable tab/surface id, `title` as the visible tab label, and `provider` as the frontend export that returns items.

```json
{
  "contributes": {
    "quickOpen": [
      {
        "id": "knowledge-files",
        "provider": "knowledgeQuickOpenProvider",
        "title": "Knowledge",
        "section": "knowledge",
        "order": 10
      }
    ]
  }
}
```

Provider items can omit `section`; omitted values are assigned to the contribution's `section` (or `id` if no section is set).
Items with a different section are ignored by that tab. Providers may expose `list()` for default results and `search(query, limit)` for content-backed search.
`order` is optional and controls tab ordering after the built-in Threads tab.

Keybindings can open a quick-open surface directly with legacy `commandPalette:<section>` or the first-class command form `command: "palette.open", args: { "scope": "knowledge" }`.

### Settings Component (`settingsComponent`)

Add one component-backed section to the main Settings page.

```json
{
  "id": "dictation",
  "component": "DictationSettingsPanel",
  "sectionId": "settings-dictation",
  "label": "Dictation",
  "description": "Enable local dictation via Whisper.cpp for the composer mic button.",
  "order": 30
}
```

The component receives `pa` and `settingsContext`. Use this for rich settings UIs; use `settings` for simple scalar settings managed by the built-in extension settings form.

### Composer Controls (`composerControls`)

Add component-backed controls in the composer bottom row. Core owns the row layout and passes composer state/actions through `controlContext`; extensions own visible controls such as attachments, model preferences, dictation, and goal mode.

```json
{
  "id": "dictation",
  "component": "DictationButton",
  "title": "Dictation",
  "slot": "preferences",
  "when": "!streamIsStreaming",
  "priority": 100
}
```

Slots are `leading`, `preferences`, and `actions`. Controls sort by `priority` ascending, then extension id, then contribution id. The component receives `pa`, `controlContext`, and the legacy alias `buttonContext`. `controlContext.renderMode` is `inline` or `menu`; `insertText(text)` inserts at the current composer selection; `openFilePicker()` opens the core-owned attachment input; and model/goal fields expose the current composer preference state.

### Composer Buttons (`composerButtons`)

Legacy alias for composer controls. Existing `placement: "afterModelPicker"` maps to `slot: "preferences"`; `placement: "actions"` maps to `slot: "actions"`. New extensions should use `composerControls`.

### Composer Input Tools (`composerInputTools`)

Add component-backed tools beside the attachment button in the composer input row. Use this for input-producing tools such as drawing editors or file-producing widgets, not submit-adjacent actions.

```json
{
  "id": "draw",
  "component": "DrawButton",
  "title": "Create drawing",
  "when": "!streamIsStreaming",
  "priority": 10
}
```

The component receives `pa` and `toolContext`. `toolContext.addFiles(files)` routes files through the normal composer attachment pipeline. `toolContext.upsertDrawingAttachment(payload)` adds an Excalidraw-compatible drawing payload to the composer. Excalidraw tools should import shared serialization helpers from `@personal-agent/extensions/excalidraw` instead of duplicating preview/source generation.

### Toolbar Actions (`toolbarActions`)

Add simple action-backed icon buttons in the composer toolbar row.
Action-based — no frontend entry needed.

```json
{
  "id": "open-browser",
  "title": "Open browser",
  "icon": "browser",
  "action": "openBrowserBackend",
  "when": "!streamIsStreaming",
  "priority": 10
}
```

**`when`** predicates:

- `composerHasContent` — input has text
- `streamIsStreaming` — agent is streaming
- `!streamIsStreaming` — agent is idle

### Composer Shelves (`composerShelves`)

Add sections in the scrollable area above the composer input.
Component-based — requires a frontend entry with a named component export.

```json
{
  "id": "status-shelf",
  "component": "StatusShelf",
  "title": "Status",
  "placement": "bottom"
}
```

**`placement`**: `"top"` (before built-in shelves) or `"bottom"` (after).

The component receives:

```typescript
{
  pa: PersonalAgentClient;
  shelfContext: {
    conversationId: string;
    isStreaming: boolean;
    isLive: boolean;
  }
}
```

### New Conversation Panels (`newConversationPanels`)

Add panels to the new conversation empty state, below the workspace selector and above the composer. Use this for draft-only guidance or prompt preparation UI that should not live inside the composer chrome.

```json
{
  "id": "suggested-context",
  "component": "SuggestedContextPanel",
  "title": "Suggested Context",
  "priority": 100
}
```

The component receives:

```typescript
{
  pa: PersonalAgentClient;
  panelContext: {
    conversationId: string;
  }
}
```

### Conversation Decorators (`conversationDecorators`)

Add badges, icons, or indicators on conversation tab items in the sidebar.
Component-based — requires a frontend entry.

```json
{
  "id": "gateway-badge",
  "component": "GatewayBadge",
  "position": "after-title",
  "priority": 10
}
```

**`position`**: `"before-title"`, `"after-title"`, or `"subtitle"` (below title).

The component receives:

```typescript
{
  pa: PersonalAgentClient;
  session: SessionMeta; // conversation metadata
}
```

### Activity Tree Item Elements (`activityTreeItemElements`)

Add small component-backed elements to the shared activity tree rows used for conversations, runs, and future work items. Core owns row layout, routing, selection, and keyboard behavior; extensions only fill safe slots.

```json
{
  "id": "thread-color-dot",
  "component": "ThreadColorDot",
  "slot": "leading",
  "priority": 10
}
```

**`slot`**: `"leading"`, `"before-title"`, `"after-title"`, `"subtitle"`, or `"trailing"`.

### Activity Tree Item Styles (`activityTreeItemStyles`)

Register backend providers for data-only row styling metadata such as accent colors, backgrounds, or tooltip text. Providers are sorted by `priority`; higher priority runs first.

```json
{
  "id": "thread-color-style",
  "provider": "getThreadColorStyle",
  "priority": 10
}
```

The host will pass activity item metadata to the provider once the activity tree UI integration is enabled. Providers should return sanitized data, not arbitrary DOM or CSS ownership.

### Context Menus (`contextMenus`)

Add right-click menu items. Action-based — no frontend entry needed.

```json
{
  "id": "copy-deeplink",
  "title": "Copy Deeplink",
  "action": "copyDeeplinkHandler",
  "surface": "conversationList"
}
```

**`surface`**: `"message"` (on message blocks) or `"conversationList"` (on sidebar items).

Conversation list backend handler receives:

```typescript
{
  conversationId: string;
  sessionTitle: string;
  cwd: string;
}
```

### Thread Header Actions (`threadHeaderActions`)

Add compact component buttons beside the Threads sidebar header. Use this for thread-list actions such as importing a session.

```json
{
  "id": "import-session",
  "component": "ImportSessionButton",
  "title": "Import Session",
  "priority": 10
}
```

The component receives `{ pa, actionContext }`; `actionContext` includes `activeConversationId` and `cwd` when available.

### Status Bar Items (`statusBarItems`)

Add labels in the status bar below the composer. Action-based — no frontend entry needed.

```json
{
  "id": "gateway-status",
  "label": "Gateway",
  "action": "openGatewayPanel",
  "alignment": "right",
  "priority": 10
}
```

**`alignment`**: `"left"` or `"right"`. **`priority`**: sort order (higher = closer to edge).
Items without an `action` are static labels. Items with an `action` are clickable.

### Protocol entrypoints (`backend.protocolEntrypoints`)

Extensions can expose host-launched stdio protocols such as ACP. The host resolves these by protocol id and wires stdin/stdout/stderr into the backend handler.

```json
{
  "backend": {
    "entry": "dist/backend.mjs",
    "protocolEntrypoints": [
      {
        "id": "acp",
        "handler": "runAcpProtocol",
        "title": "Agent Client Protocol"
      }
    ]
  }
}
```

The handler receives `ExtensionProtocolContext`, which extends the normal backend context with:

- `protocolId`
- `stdio.stdin`
- `stdio.stdout`
- `stdio.stderr`
- `signal`

These entrypoints are intended for long-lived protocol sessions, not one-shot actions.

### Tools

Extensions can register agent-callable tools. The agent sees them as
`extension_{extensionId}_{toolId}` unless a custom `name` is given.

Tool availability is intentionally stable for the life of an agent session.
Do not mutate the active tool list at runtime; register tools once and return a
clear validation error from the handler when the current app state does not
support a call. The legacy `setActiveTools` API is deprecated and blocked by the
desktop runtime.

The tool definition already gives the model the `description` and JSON-schema
`inputSchema`, including parameter descriptions. Keep `promptGuidelines`
high-signal: use them only for behavior the schema cannot express, such as when
not to use the tool, safety boundaries, or required follow-up behavior. One short
sentence is the default. If a workflow needs more than that, contribute an
extension skill instead of stuffing a mini manual into every prompt.

```json
{
  "id": "summarize",
  "name": "summarize_text",
  "description": "Summarize a block of text",
  "action": "summarizeHandler",
  "inputSchema": {
    "type": "object",
    "properties": {
      "text": { "type": "string" }
    },
    "required": ["text"]
  }
}
```

#### Overriding built-in tools

Extension tools can replace built-in tools using the `replaces` field.
When set, the tool registers under the built-in tool's name, overriding it.

```json
{
  "id": "my-bash",
  "description": "Safer bash execution with logging",
  "action": "bashHandler",
  "replaces": "bash",
  "inputSchema": {
    "type": "object",
    "properties": {
      "command": { "type": "string" }
    },
    "required": ["command"]
  }
}
```

Supported overridable tools: `bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`, `notify`, `web_fetch`, `web_search`.

The replacement tool must accept the same input schema as the original
and return compatible output.

#### Streaming progress in tool handlers

Backend action handlers called from manifest-declared tools can stream
progress updates during execution using `ctx.toolContext?.onUpdate()`.

```typescript
export async function longRunningHandler(input: unknown, ctx: ExtensionBackendContext) {
  // Send progress updates back to the agent
  ctx.toolContext?.onUpdate?.({
    content: [{ type: 'text', text: 'Step 1 of 3 complete...' }],
  });

  const result = await doWork();

  // Final result
  return { content: [{ type: 'text', text: 'Done!' }] };
}
```

This is useful for tools that take multiple seconds to complete — the
agent sees intermediate progress instead of waiting silently.```

## Frontend (UI)

Your `src/frontend.tsx` exports React components referenced in the manifest. The desktop app loads the extension registry once at the app shell and shares it through context; do not add per-message or per-tool registry fetches in frontend hosts.

```tsx
import type { ExtensionSurfaceProps } from '@personal-agent/extensions';

export function MyPanel({ pa, context }: ExtensionSurfaceProps) {
  return (
    <div>
      <button onClick={() => pa.ui.toast('Hello!')}>Test Toast</button>
    </div>
  );
}
```

The `pa` client provides:

- `pa.extension.invoke(actionId, input)` — call backend actions
- `pa.ui.toast(message, type)` — show toast notification
- `pa.ui.confirm(options)` — show confirmation dialog (`{ title?, message }`)
- `pa.ui.openModal(options)` — open a custom modal dialog (`{ title?, component, props? }`). The `component` must be a named export from your extension's frontend entry. It receives `{ pa, props, close }`. Returns a promise that resolves when the modal is closed.
- `pa.storage.*` — read/write extension state
- `pa.workspace.*` — workspace file operations
- `pa.browser.*` — browser control
- `pa.runs.*` — background run operations
- `pa.automations.*` — scheduled task management
- `pa.events.publish(event, payload)` — publish inter-extension events
- `pa.extensions.callAction(id, action, input)` — call another extension's action
- `pa.extensions.listActions()` — list available extension actions

See `packages/extensions/src/index.ts` for the full API.

Backend-only host APIs that should stay narrow can also be exposed through focused SDK subpaths such as `@personal-agent/extensions/backend/artifacts`, `/automations`, `/browser`, `/compaction`, `/conversations`, `/images`, `/knowledge`, `/knowledgeVault`, `/mcp`, `/runs`, `/runtime`, `/telemetry`, and `/webContent`. Prefer a focused subpath over the broad backend barrel when bundling a system extension that only needs one backend service. For daemon-backed shell work in a packaged system extension, keep the foreground path free of daemon imports and lazy-load background-run support only when the action actually starts or inspects background work.

The backend API is deliberately two-layered: public stubs under `packages/extensions/src/backend/*.ts`, and host implementations under `packages/desktop/server/extensions/backendApi/*.ts`. Extension source imports only `@personal-agent/extensions/backend/{name}`. It must not import desktop server files, `@personal-agent/core`, `@personal-agent/daemon`, or agent-runtime internals directly. System extension source may use type-only Pi imports for extension hook types, but runtime value imports from Pi must go through a focused host seam. Host backend API modules should be thin adapters; lazy-load heavy desktop/runtime modules inside functions so packaged extension bundles do not accidentally drag in half the app. `pnpm run check:extensions:quick` enforces this with `scripts/check-extension-backend-api.mjs` and packaged source/bundle checks before packaged bundle checks run.

Backend seam permission model: seams that run user-visible privileged workflows still require explicit extension permissions (`agent:run`, `agent:conversations`, etc.). Narrow host helpers such as `/compaction`, `/runtime`, and `/webContent` are trusted system-extension internals; they do not create standalone user-facing authority and should stay scoped to active hook/action context rather than growing into broad service APIs.

For model-backed extension workflows, use `@personal-agent/extensions/backend/agent` instead of importing Pi directly. `runAgentTask` runs a host-owned one-shot hidden agent task with optional image inputs, `tools: 'none'`, and timeout cleanup; the host owns model lookup, auth storage, session creation, cancellation boundaries, and runtime policy. Extensions must declare `agent:run` to use this seam. For multi-turn extension-owned workers, use `createAgentConversation`, `sendAgentMessage`, `getAgentConversation`, `listAgentConversations`, `abortAgentConversation`, and `disposeAgentConversation`; conversations support hidden+ephemeral private worker sessions and visible+saved host conversations that appear in the normal conversation system. Both modes are scoped to the owner extension id and require `agent:conversations`.

Backend extensions can record fire-and-forget app telemetry through the dedicated telemetry seam:

```ts
import { recordTelemetryEvent } from '@personal-agent/extensions/backend/telemetry';

recordTelemetryEvent({ source: 'agent', category: 'my_extension', name: 'action_completed', durationMs: 42 });
```

Backend action handlers can also use `ctx.telemetry.record(...)`, which records the same event shape and adds the current extension id to metadata automatically.

## Main page layout

Main-route extension pages should use the shared app page primitives instead of hand-rolled widths or padding:

```tsx
<div className="h-full overflow-y-auto">
  <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="space-y-10">
    <AppPageIntro title="Page title" summary="One sentence explaining what this page controls." actions={actions} />
    {/* page sections */}
  </AppPageLayout>
</div>
```

Use the same `max-w-[72rem]`, `space-y-10`, and `AppPageIntro` title/summary pattern for normal pages. Only use a wider shell for table-heavy management surfaces that genuinely need it.

## Styling guidance

Extension UIs should look native to Personal Agent, not like embedded websites. Default to the shared primitives from `@personal-agent/extensions/ui` and Tailwind utility classes that use app theme tokens.

```tsx
<section className="space-y-4 border-t border-border-subtle pt-6">
  <div className="flex items-baseline justify-between gap-4">
    <h2 className="text-[18px] font-semibold tracking-tight text-primary">Section title</h2>
    <span className="text-[12px] text-dim">Optional metadata</span>
  </div>
  <p className="max-w-3xl text-[13px] leading-6 text-secondary">Short explanatory copy.</p>
  <ToolbarButton>Action</ToolbarButton>
</section>
```

Guidelines:

- Use semantic theme tokens: `bg-base`, `bg-surface`, `bg-elevated`, `text-primary`, `text-secondary`, `text-dim`, `border-border-subtle`, `text-accent`, `text-success`, `text-warning`, and `text-danger`.
- Avoid hard-coded colors, custom shadows, gradients, decorative pills, and nested bordered cards. Spacing, typography, and alignment should do most of the hierarchy work.
- Keep typography consistent: page titles come from `AppPageIntro`; section titles are usually `text-[18px] font-semibold tracking-tight`; body copy is usually `text-[13px] leading-6 text-secondary`.
- Prefer `ToolbarButton`, `EmptyState`, `LoadingState`, `ErrorState`, `AppPageEmptyState`, and `AppPageSection` over local button/state implementations.
- Right-rail and panel views are compact tools, not full pages. Use tighter padding, smaller type, and avoid page-scale headers there.

If a page needs a style that fights these defaults, first ask whether it should be a new shared primitive. One-off chrome is how UI entropy sneaks in wearing a fake mustache.

## Backend (Server-side)

The backend runs in the Node.js server process. It exposes actions
that the frontend can call via `pa.extension.invoke()`. A backend can also declare `onEnableAction` in `extension.json` to run an action immediately after the user enables the extension.

```typescript
import type { ExtensionBackendContext } from '@personal-agent/extensions';

export async function ping(_input: unknown, ctx: ExtensionBackendContext) {
  ctx.log.info('ping received');
  return { ok: true, at: new Date().toISOString() };
}
```

### Settings

Extensions can declare user-facing settings in their manifest. These appear
in the Settings UI (under "Extensions") grouped by the `group` field — no
React code required for basic types.

```json
{
  "contributes": {
    "settings": {
      "myExt.timeout": {
        "type": "number",
        "default": 30,
        "description": "Timeout in seconds",
        "group": "My Extension",
        "order": 1
      },
      "myExt.featureEnabled": {
        "type": "boolean",
        "default": true,
        "description": "Enable the new feature",
        "group": "My Extension",
        "order": 2
      },
      "myExt.mode": {
        "type": "select",
        "default": "auto",
        "enum": ["auto", "manual", "off"],
        "description": "Operation mode",
        "group": "My Extension",
        "order": 3
      }
    }
  }
}
```

Each setting key is a dot-separated path (e.g. `myExt.timeout`).
The Settings UI renders the appropriate control based on `type`:

| Type      | Control      |
| --------- | ------------ |
| `string`  | Text input   |
| `boolean` | Checkbox     |
| `number`  | Number input |
| `select`  | Dropdown     |

All settings are stored in a single `<stateRoot>/settings.json` file.

| Property      | Description                                   | Required   |
| ------------- | --------------------------------------------- | ---------- |
| `type`        | `string`, `boolean`, `number`, or `select`    | Yes        |
| `default`     | Default value                                 | No         |
| `description` | Shown next to the field in the Settings UI    | No         |
| `group`       | Groups settings together. Default `"General"` | No         |
| `enum`        | Allowed values for `select` type              | For select |
| `placeholder` | Placeholder text for string inputs            | No         |
| `order`       | Sort order within group. Default 0.           | No         |

#### Settings vs Extension Storage

Extensions have two storage mechanisms for different purposes:

| Mechanism    | Location                             | Purpose                                  |
| ------------ | ------------------------------------ | ---------------------------------------- |
| **Settings** | `<stateRoot>/settings.json` (shared) | User-facing config declared in manifest  |
| **Storage**  | SQLite-backed, per-extension         | Internal runtime state (caches, session) |

- Use **settings** for values the user configures through the Settings UI.
- Use **storage** (`ctx.storage` / `pa.storage`) for internal state like
  cached API responses, session tokens, or counter values.
- Settings are discoverable (all extensions contribute to a unified schema);
  storage is private to each extension.

### Backend Context (`ctx`)

The `ExtensionBackendContext` provides:

| Property            | Purpose                                                  |
| ------------------- | -------------------------------------------------------- |
| `ctx.storage`       | Persistent key-value store per extension (SQLite-backed) |
| `ctx.automations`   | Scheduled task management                                |
| `ctx.runs`          | Background run management                                |
| `ctx.conversations` | Conversation read/write operations                       |
| `ctx.workspace`     | Workspace file operations (read, write, list)            |
| `ctx.vault`         | Knowledge vault operations                               |
| `ctx.git`           | Git status, diff, log                                    |
| `ctx.shell`         | Shell command execution                                  |
| `ctx.notify`        | Toast, system notifications, badge (see below)           |
| `ctx.events`        | Inter-extension event pub/sub                            |
| `ctx.extensions`    | Call actions on other extensions                         |
| `ctx.ui`            | Invalidate UI state topics                               |
| `ctx.log`           | Structured logging                                       |

## Conversation Write API

The `conversations` object in the backend context now supports
write operations in addition to reads.

```typescript
// Send a message into a live conversation
await ctx.conversations.sendMessage(
  conversationId,
  'Your message here',
  { steer: true }, // or { steer: false } for followUp
);

// Update the conversation title
await ctx.conversations.setTitle(conversationId, 'New Title');

// Trigger compaction
await ctx.conversations.compact(conversationId);

// Read operations (pre-existing)
await ctx.conversations.list();
await ctx.conversations.getMeta(conversationId);
await ctx.conversations.get(conversationId, { tailBlocks: 20 });
await ctx.conversations.searchIndex(sessionIds);
```

**Permission required:** `conversations:readwrite` for write operations.

The `conversations` capability also exposes first-class lifecycle helpers:

```typescript
const created = await ctx.conversations.create({ title: 'Research thread', cwd, initialPrompt: 'Start here' });
const forked = await ctx.conversations.fork({ conversationId, title: 'Bug bash branch' });
```

**Limitations:**

- Most mutating operations still require the source conversation to be live (in-memory).

## Selection actions, transcript blocks, services, and subscriptions

Extensions can declare selection-aware actions for selected text, files, messages, or transcript ranges. The frontend SDK exposes `pa.selection.get()`, `pa.selection.set(...)`, and `pa.selection.subscribe(...)`; hosts and extensions publish the current selection through the same shared model.

```json
{
  "contributes": {
    "selectionActions": [{ "id": "send-selection", "title": "Send to Board", "action": "sendSelection", "kinds": ["text", "messages"] }]
  }
}
```

Extensions can declare custom durable transcript block renderers and write extension-authored blocks from backend code. Blocks get stable `extensionBlockId` metadata; updates mutate the live transcript block and fail if the block id is not found.

```json
{
  "contributes": {
    "transcriptBlocks": [{ "id": "approval", "component": "ApprovalBlock", "schemaVersion": 1 }]
  }
}
```

```typescript
await ctx.conversations.appendTranscriptBlock({ conversationId, blockType: 'approval', data: { status: 'pending' } });
await ctx.conversations.updateTranscriptBlock({ conversationId, blockId, blockType: 'approval', data: { status: 'approved' } });
```

Long-lived backend services are declared under `backend.services` so the host can own lifecycle, health, and restart policy. Enabled extension services are started during extension startup; a service handler may return a stop function that the host calls on shutdown, disable, reload, or restart. Extension Manager shows declared services plus live runtime state (`running`, `stopped`, start time) from the host.

```json
{
  "backend": {
    "entry": "dist/backend.mjs",
    "services": [{ "id": "sync", "handler": "startSync", "healthCheck": "checkSync", "restart": "on-failure" }],
    "onDisableAction": "stopSync",
    "onUninstallAction": "cleanup"
  }
}
```

Event subscriptions are declared under `contributes.subscriptions` for host-owned event sources such as workspace files, vault files, settings, conversations, routes, and selection changes. The host dispatches these through the extension event bus as `host:{source}` events; `pattern` narrows the event name. Current built-in producers include `host:workspaceFiles` for workspace writes/deletes/renames/moves, `host:settings` for settings updates, and frontend `host:selection` notifications when shared selection changes.

```json
{
  "contributes": {
    "subscriptions": [{ "id": "watch-notes", "source": "vaultFiles", "pattern": "notes/**", "handler": "onVaultChange" }]
  }
}
```

Secrets are public manifest API, not an internal convention:

```json
{
  "contributes": {
    "secrets": {
      "apiKey": { "label": "API key", "env": "MY_EXTENSION_API_KEY" }
    }
  },
  "permissions": ["secrets:read"]
}
```

Resolve them in backend code with `ctx.secrets.get('apiKey')`. Environment variables declared by the extension take precedence over stored values.

Extensions can declare dependencies on other extensions:

```json
{
  "dependsOn": ["system-knowledge", { "id": "agent-board", "optional": true, "version": "^1.0.0" }]
}
```

Missing required dependencies are surfaced in Extension Manager diagnostics and block enabling the dependent extension. Optional dependencies are documentation/discovery contracts and should be checked with `pa.extensions.getStatus(...)` or `ctx.extensions.getStatus(...)` before use.

## Inter-extension Communication

Extensions can communicate with each other through a shared event bus
and by calling each other's actions.

### Event Bus

Publish events that other extensions subscribe to:

```typescript
// In extension A — backend.ts
await ctx.events.publish({
  event: 'task:completed',
  payload: { taskId: '123', result: 'success' },
});
```

Subscribe to events from other extensions:

```typescript
// In extension B — backend.ts
const sub = ctx.events.subscribe('task:*', async (event) => {
  console.log(`Received ${event.event} from ${event.sourceExtensionId}`);
  // event.payload, event.publishedAt
});

// Later, to unsubscribe:
sub.unsubscribe();
```

**Pattern syntax:**

- `"*"` — matches all events
- `"task:*"` — matches `task:completed`, `task:failed`, etc.
- `"task:completed"` — exact match only

### Cross-extension Action Calls

Call an action exposed by another extension:

```typescript
const result = await ctx.extensions.callAction('other-extension', 'someAction', { key: 'value' });
```

List available extension actions:

```typescript
const actions = await ctx.extensions.listActions();
// Returns: [{ extensionId, extensionName, actions: [{ id, title, description }] }]
```

## Notifications and Badge

Extensions can send notifications and set dock badges:

```typescript
// In-app toast
ctx.notify.toast('Hello!', 'info'); // "info" | "warning" | "error"

// System notification (macOS notification centre)
ctx.notify.system({
  title: 'Task Complete',
  message: 'Your background task finished.',
  subtitle: 'Optional subtitle',
  persistent: true, // stays until acknowledged
});

// Dock badge count (accumulated across all extensions)
ctx.notify.setBadge(5); // Set badge to 5
ctx.notify.clearBadge(); // Clear this extension's badge

// Check if system notifications are available
const available = ctx.notify.isSystemAvailable();
```

## Permissions

Extensions must declare the permissions they need. The system currently
enforces permissions for storage and conversation operations.

```json
{
  "permissions": [
    "storage:read",
    "storage:write",
    "storage:readwrite",
    "conversations:read",
    "conversations:readwrite",
    "vault:read",
    "vault:write",
    "vault:readwrite",
    "runs:read",
    "runs:start",
    "runs:cancel",
    "ui:notify"
  ]
}
```

Custom permissions are also supported: `"${string}:${string}"`.

## Agent Lifecycle Hooks

Desktop manifest extensions can hook into the agent's lifecycle by
exporting an `ExtensionFactory` function via the `backend.agentExtension` field.

```typescript
// backend.ts — exported as the value referenced by agentExtension
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  // Subscribe to agent lifecycle events
  pi.on('before_agent_start', async (event, ctx) => {
    // Modify the system prompt before each turn
    return {
      systemPrompt: event.systemPrompt + '\nExtra instructions for this turn...',
    };
  });

  pi.on('tool_call', async (event, ctx) => {
    // Block or modify tool calls
    if (event.toolName === 'bash' && event.input.command?.includes('rm -rf')) {
      return { block: true, reason: 'Dangerous command blocked by extension' };
    }
  });

  pi.on('tool_result', async (event, ctx) => {
    // Post-process results
    if (event.toolName === 'read') {
      return { content: [{ type: 'text', text: event.content + '\n— End of file' }] };
    }
  });

  pi.on('session_start', async (event, ctx) => {
    ctx.ui.notify(`Session started: ${event.reason}`, 'info');
  });

  // Register custom tools
  pi.registerTool({
    name: 'my_tool',
    label: 'My Tool',
    description: 'A custom tool',
    parameters: { type: 'object', properties: {} },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return { content: [{ type: 'text', text: 'Done!' }] };
    },
  });

  // Override a built-in tool
  pi.registerTool({
    name: 'bash', // Same name as built-in → replaces it
    label: 'Safe Bash',
    description: 'Bash with guardrails',
    parameters: { type: 'object', properties: { command: { type: 'string' } } },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // Custom implementation
      return { content: [{ type: 'text', text: params.command }] };
    },
  });
}
```

Then in your manifest:

```json
{
  "backend": {
    "entry": "src/backend.ts",
    "agentExtension": "default"
  }
}
```

The `agentExtension` field names the exported function that receives
the `ExtensionAPI`. If set to `"default"`, the default export is used.

**All pi-coding-agent events are available:**

| Event                      | When                                | Use Case                             |
| -------------------------- | ----------------------------------- | ------------------------------------ |
| `before_agent_start`       | Before the agent processes a prompt | Inject context, modify system prompt |
| `input`                    | User input received                 | Intercept or transform input         |
| `context`                  | Before LLM call                     | Modify messages                      |
| `tool_call`                | Before tool execution               | Block/modify tool calls              |
| `tool_result`              | After tool execution                | Post-process results                 |
| `session_start`            | Session loaded                      | Initialize state                     |
| `session_shutdown`         | Session ending                      | Clean up resources                   |
| `session_before_compact`   | Before compaction                   | Customize compaction                 |
| `message_start/update/end` | Message lifecycle                   | Custom rendering                     |
| `turn_start/end`           | Turn lifecycle                      | Track progress                       |
| `agent_start/end`          | Agent cycle lifecycle               | Track agent activity                 |

For the full list of events and their signatures, see the
[pi-coding-agent extensions documentation](../../node_modules/@earendil-works/pi-coding-agent/docs/extensions.md).

## Development Workflow

### Building

Extensions need to be built before they can be loaded:

```bash
POST /api/extensions/my-ext/build

# Or from the extension manager UI, click "Build"
# Or from the repo for a local extension directory:
pnpm run extension:build -- /path/to/my-extension
```

Frontend builds bundle the authoring SDK UI modules (`@personal-agent/extensions/ui`, `/host`, `/workbench`, `/data`, and `/settings`) into `dist/frontend.js`. The browser loads that built file directly from `/api/extensions/<id>/files/...`, so frontend dist output must not leave `@personal-agent/extensions/*` as bare runtime imports.

### Hot Reload

After changing backend code:

```bash
POST /api/extensions/my-ext/reload
```

Note: the frontend is re-evaluated on page load. Use the extension
manager UI's "Reload" button or restart the app.

### Testing Integration

Run the extension integration smoke tests to catch cross-extension issues
before starting the app (manifest validation, route conflicts, missing
backend/frontend entries, handler export mismatches, and packaged-runtime
backend import failures):

```bash
# Run the full extension integration suite (includes ~25s dynamic import check)
pnpm run check:extensions

# Quick check (skips slow dynamic import test, ~5s)
pnpm run check:extensions:quick

# Run alongside the server endpoint smoke tests
npx vitest run packages/desktop/server/extensions/extensionIntegration.smoke.test.ts \
  packages/desktop/server/routes/registerAll.smoke.test.ts

# Or include in the full test suite
pnpm test
```

`pnpm run check:extensions` and `pnpm run check:extensions:quick` first run
`scripts/check-extension-backend-api.mjs` to keep the SDK backend subpath list and
host backend API implementation list in lockstep, and to block backend API seams
from statically importing known heavy/runtime internals. They also run
`scripts/check-packaged-extensions.mjs`. That packaged check imports every system
and experimental extension backend from its built `dist` output, verifies backend
action handler exports, smoke-calls known safe `list` tools (`scheduled_task`,
`conversation_queue`, `run`), and runs product-critical smoke calls for Knowledge,
Automations, and Diffs extension actions. It fails on forbidden bare imports
that are not available inside the packaged desktop app, such as
`@earendil-works/pi-coding-agent`, `@personal-agent/core`,
`@personal-agent/daemon`, `jsdom`, and `@sinclair/typebox`. It also rejects
absolute or `file:` imports, forbidden bundled runtime path fragments, and backend
bundles over their explicit byte budget. The packaged-extension hardening knobs
live in `scripts/extension-hardening-config.mjs`, so smoke inputs and size budgets
are explicit instead of being buried in the checker. This catches release-temp
paths, accidental daemon bundling, runaway backend API seams, and the “works from
repo node_modules, breaks in the signed app” class of extension bug before
release.

The desktop server also runs an enabled-extension backend health check on startup.
Failures are logged, surfaced as extension diagnostics, and shown by Extension
Manager instead of silently making tools or actions disappear. System extension
diagnostics are release blockers: the integration smoke suite fails when a system
extension has registry errors, diagnostics, stale `dist/` output, missing exports,
forbidden imports, or backend import crashes. Extension builds write
`dist/build-manifest.json` with output files, byte sizes, and remaining external
imports. Extension Manager also exposes the `extension_manager` agent tool for
local extension authoring: `list`, `create`, `snapshot`, `build`, `validate`, and
`reload`. Run `validate` after each build to check manifest references, dist
files, stale output, frontend/backend exports, tool schemas, skill files,
forbidden process imports, non-portable bundled imports, and backend import
crashes for one extension. The release publisher reruns the packaged-extension
check against the built `.app` before notarization/upload.

The integration suite covers 79 tests across 12 categories:

| Category                  | What it validates                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest structure        | JSON parses, schemaVersion, version field, required fields, permissions format, routes, startup action validity, backend/no-backend consistency           |
| Tool schema               | `inputSchema` has `type:object` + `properties`, `replaces` targets valid built-ins                                                                        |
| Action references         | All `action` fields in context menus, commands, toolbar actions, nav badge actions reference known backend handlers or valid system patterns              |
| Settings/Secrets          | Setting type/default consistency, select enum values, dot-separated key format, secret env var format                                                     |
| Frontend components       | Every component field in views/buttons/shelves/panels exists in the frontend bundle                                                                       |
| Cross-extension conflicts | Duplicate IDs, routes, tool names, commands, keybindings, settings, secrets, env variables, mention ids, prompt reference/context provider/quick open ids |
| Registry sanity           | All 25 system extensions registered, routes point to real extensions                                                                                      |
| Backend files             | `dist/backend.mjs` exists, source files present, handler names match                                                                                      |
| Frontend files            | `dist/frontend.js` exists, style files present                                                                                                            |
| Agent extensions          | Registration listing, export names, backend entry references                                                                                              |
| Skills                    | File existence, valid Agent Skills frontmatter                                                                                                            |
| Summary report            | Printed overview with counts across 21 registration categories                                                                                            |

### Debugging

- Backend logs appear in the server console with `[extension:my-ext]` prefix.
- Frontend errors appear in the web console.
- Use `ctx.log.info/warn/error()` for structured logging.
- Check the extension manager UI for diagnostics.

### State

Extensions get persistent key-value storage:

```typescript
// Write
await ctx.storage.put('my-key', { count: 42 });

// Read
const data = await ctx.storage.get('my-key');

// List
const items = await ctx.storage.list('prefix-');

// Delete
await ctx.storage.delete('my-key');
```

State is SQLite-backed and survives app restarts.

## Examples

See the system extensions in `extensions/` for practical examples:

- **`system-artifacts`** — Tools + views + transcript renderer + skills
- **`system-browser`** — Browser automation tool + views
- **`system-automations`** — Scheduled tasks, reminders, conversation queues, and the Automations page
- **`system-images`** — Experimental image generation tool (`experimental-extensions/extensions/system-images`)
- **`system-conversation-tools`** — Agent lifecycle hooks + contextMenus
- **`system-extension-manager`** — Extension management UI + nav
- **`system-runs`** — Background runs + composer shelf (ActivityShelf)
- **`system-gateways`** — Experimental Telegram gateway management UI + nav (`experimental-extensions/extensions/system-gateways`)
- **`system-settings`** — Settings panels + nav

Each system extension has a complete `extension.json` manifest and
`src/backend.ts` + optionally `src/frontend.tsx`.

Bundled system extensions keep source next to their built output for development. Backend `dist/` output is authoritative by default in both dev and packaged runtimes: if `backend.entry` points at source (`src/backend.ts`), normal app startup loads sibling `dist/backend.mjs`; source recompilation is reserved for explicit extension-authoring mode (`PERSONAL_AGENT_EXTENSION_AUTHORING=1`). If `backend.entry` already points at built output such as `dist/backend.mjs`, both dev and packaged builds load that file directly. System extension frontends are bundled into the desktop renderer from source so they share the app's React singleton; their `dist/frontend.js` bundles are still built and validated as release artifacts.
