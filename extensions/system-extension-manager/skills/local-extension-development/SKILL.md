---
name: local-extension-development
description: Use when creating, editing, building, validating, reloading, importing, or debugging Personal Agent native extensions from inside the built app.
metadata:
  id: local-extension-development
  title: Local Extension Development
  summary: Built-in workflow and reference for agents building native extensions with packaged app resources and Extension Manager APIs.
  status: active
---

# Local Extension Development

Use this skill when an agent is asked to build, fix, or inspect a Personal Agent extension locally. It is packaged with the built app, so it must be self-contained enough to use without a source checkout.

## Fast rule

Build native extensions: a folder with `extension.json`, optional `src/frontend.tsx`, optional `src/backend.ts`, and generated `dist/` bundles. The app loads manifest-declared `dist/*` entries. Do not create iframe/webview extensions.

## First moves

1. Inspect installed extensions through Extension Manager or `GET /api/extensions/installed`.
2. If editing an existing user extension, snapshot it first from Extension Manager.
3. If creating a new extension, call `POST /api/extensions` with a starter template.
4. Edit `src/` files and `extension.json`, then build and reload.
5. Open the declared route/surface and visually inspect UI changes.
6. Check Extension Manager diagnostics before reporting done.

Starter create payload:

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "description": "One sentence about what this extension does.",
  "template": "main-page"
}
```

Templates:

- `main-page` — global app page with `/ext/{id}` route and sidebar nav.
- `right-rail` — conversation-scoped right rail panel.
- `workbench-detail` — right rail selector paired with a workbench detail view.

## Package layout

```text
my-extension/
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
    build-manifest.json
  skills/
    my-extension/SKILL.md
```

`src/` is source of truth. `dist/` is generated output. Packaged app runtimes load `dist/` and do not rely on TypeScript source.

## Minimal manifest

```json
{
  "schemaVersion": 2,
  "id": "my-extension",
  "name": "My Extension",
  "description": "One sentence about what this extension does.",
  "version": "0.1.0",
  "packageType": "user",
  "frontend": {
    "entry": "dist/frontend.js",
    "styles": []
  },
  "backend": {
    "entry": "dist/backend.mjs",
    "actions": [{ "id": "ping", "handler": "ping", "title": "Ping" }]
  },
  "contributes": {
    "views": [{ "id": "page", "title": "My Extension", "location": "main", "route": "/ext/my-extension", "component": "ExtensionPage" }],
    "nav": [{ "id": "nav", "label": "My Extension", "route": "/ext/my-extension", "icon": "app" }]
  },
  "permissions": []
}
```

Rules:

- `id` is stable kebab-case. Use `/ext/{id}` for user extension pages.
- Frontend `component` values must be named exports from `src/frontend.tsx`.
- Backend action `handler` values must be named exports from `src/backend.ts`.
- Declare host contributions in the manifest; code implements them.
- Use `defaultEnabled: false` for experimental extensions that should be visible but inactive until enabled.

## Common contributions

### Main page

```json
{
  "views": [{ "id": "page", "title": "Tasks", "location": "main", "route": "/ext/tasks", "component": "TasksPage" }],
  "nav": [{ "id": "nav", "label": "Tasks", "route": "/ext/tasks", "icon": "app" }]
}
```

### Right rail

```json
{
  "views": [{ "id": "panel", "title": "Tasks", "location": "rightRail", "scope": "conversation", "component": "TasksPanel", "icon": "app" }]
}
```

### Workbench detail paired with right rail

```json
{
  "views": [
    { "id": "rail", "title": "Files", "location": "rightRail", "scope": "conversation", "component": "FilesRail", "detailView": "detail" },
    { "id": "detail", "title": "File", "location": "workbench", "component": "FileDetail" }
  ]
}
```

### Backend-backed tool

```json
{
  "backend": {
    "entry": "dist/backend.mjs",
    "actions": [{ "id": "search", "handler": "search", "title": "Search" }]
  },
  "contributes": {
    "tools": [
      {
        "id": "search",
        "name": "my_extension_search",
        "description": "Search this extension's data.",
        "action": "search",
        "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] }
      }
    ]
  }
}
```

### Skill contribution

```json
{
  "contributes": {
    "skills": [{ "id": "my-workflow", "title": "My Workflow", "description": "When to use it.", "path": "skills/my-workflow/SKILL.md" }]
  }
}
```

Skill files need Agent Skills frontmatter and enough procedural detail to operate from the built app.

## Frontend source pattern

```tsx
import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import { AppPageLayout, EmptyState, ToolbarButton } from '@personal-agent/extensions/ui';

export function ExtensionPage({ pa }: ExtensionSurfaceProps) {
  async function ping() {
    const result = await pa.extension.invoke('ping', {});
    pa.ui.toast(`Ping: ${JSON.stringify(result)}`);
  }

  return (
    <AppPageLayout title="My Extension" description="One sentence about the page.">
      <EmptyState title="Ready" description="The extension is wired up." />
      <ToolbarButton onClick={ping}>Ping backend</ToolbarButton>
    </AppPageLayout>
  );
}
```

Frontend rules:

- Import app-native primitives from `@personal-agent/extensions/ui` instead of building isolated card-heavy UI.
- Use `pa.extension.invoke(actionId, input)` for backend calls.
- Use `pa.storage`, `pa.events`, and `pa.extensions` for host-provided client capabilities when available.
- Keep exported component names exactly aligned with `extension.json`.
- Use app theme tokens and shared primitives; avoid decorative nested boxes and iframe-style layouts.

## Backend source pattern

```ts
import type { ExtensionBackendContext } from '@personal-agent/extensions';

export async function ping(input: unknown, ctx: ExtensionBackendContext) {
  ctx.log.info('ping', { input });
  await ctx.storage.put('lastPing', { at: new Date().toISOString() });
  return { ok: true, at: new Date().toISOString() };
}
```

Backend rules:

- Use `ctx.storage` for persistent extension state.
- Use `ctx.log.info/warn/error` for structured logs.
- Use `ctx.shell` and `ctx.git` for process execution. Do not import `child_process`, `worker_threads`, or similar direct process APIs.
- Use `ctx.events.publish/subscribe` and `ctx.extensions.callAction/listActions` for inter-extension communication.
- Keep module scope side-effect-light. Backend modules are imported during health checks and validation.

## Settings and state

Use manifest settings for user-visible configuration:

```json
{
  "contributes": {
    "settings": {
      "myExtension.enabled": { "type": "boolean", "title": "Enabled", "default": true },
      "myExtension.mode": { "type": "select", "title": "Mode", "enum": ["fast", "safe"], "default": "safe" }
    }
  }
}
```

Use `ctx.storage` / `pa.storage` for private runtime state, caches, and per-extension records.

## Dependencies

`package.json` should be small:

```json
{
  "type": "module",
  "dependencies": {
    "@personal-agent/extensions": "*"
  }
}
```

Normal third-party dependencies are bundled into `dist/` by the builder. Host packages such as `@personal-agent/extensions`, `react`, and `react-dom` are provided by the app. If package tooling is unavailable in the built app, avoid adding new dependencies or vendor a tiny local helper.

Never import app internals like `packages/desktop/server/*`, `packages/desktop/ui/*`, `@personal-agent/core`, or `@personal-agent/daemon` from an extension. If a host capability is missing, the right platform change is a reusable SDK/backend subpath, not a private import.

## Build and reload

Built app path:

1. Build with Extension Manager **Build** or `POST /api/extensions/{id}/build`.
2. Reload with Extension Manager **Reload** or `POST /api/extensions/{id}/reload`.
3. Inspect diagnostics in Extension Manager.

Repo checkout fallback:

```bash
node scripts/extension-build.mjs /path/to/extension
node scripts/check-packaged-extensions.mjs
```

If `pnpm` exists:

```bash
pnpm run extension:build -- /path/to/extension
pnpm run check:extensions
pnpm run check:extensions:quick
```

Do not depend on repo scripts from an installed app unless the repo checkout is explicitly present.

## Validation checklist

Before reporting done:

- `extension.json` parses and all contribution references match real exports.
- `dist/frontend.js` exists when `frontend.entry` is declared.
- `dist/backend.mjs` exists when `backend.entry` is declared.
- Build/reload succeeded without Extension Manager diagnostics.
- Backend imports at module scope without throwing.
- No absolute, `file:`, release-temp, or machine-local imports remain in `dist/`.
- No direct process APIs are imported by backend source.
- UI surfaces open and look native.
- README explains what the extension does and how to use it.

## Debugging guide

- `Failed to fetch dynamically imported module .../dist/frontend.js`: missing/stale frontend bundle. Build and reload.
- Blank surface or missing component: manifest `component` does not match a named frontend export, or frontend import crashed.
- Backend action/tool disappears: backend import failed or action handler export is missing. Check Extension Manager diagnostics and backend logs.
- `Cannot find module` with an absolute temp path: bundle contains a non-portable import. Rebuild with the app builder and remove private/absolute imports.
- Handler not found: manifest action `handler` does not match a named backend export.
- Tool schema validation errors: `inputSchema` must be an object schema with `type: "object"` and `properties`.
- Permission/setting errors: permissions use `resource:action`; setting keys should be dot-separated.
- Build rejects process imports: replace direct Node process APIs with `ctx.shell` or `ctx.git`.

## Packaged references

When details matter, read these packaged resources if available:

- `docs/extensions.md` — full native extension contract.
- `extensions/system-extension-manager/README.md` — Extension Manager behavior and operations.
- Existing system extension READMEs — examples of tools, pages, rails, settings, skills, and backend actions.
- Extension API docs surfaced in the app docs. In a repo checkout this is `packages/extensions/README.md`.
