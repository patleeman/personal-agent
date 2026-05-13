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

1. Inspect installed extensions through Extension Manager, `GET /api/extensions/installed`, or the `extension_manager` tool with `{ "action": "list" }`.
2. If editing an existing user extension, snapshot it first with `{ "action": "snapshot", "id": "..." }`.
3. If creating a new extension, use `{ "action": "create", "id": "...", "name": "...", "template": "main-page" }` or `POST /api/extensions`.
4. Edit `src/` files and `extension.json`, then build with `{ "action": "build", "id": "..." }`.
5. Validate with `{ "action": "validate", "id": "..." }` and fix every error.
6. Reload with `{ "action": "reload", "id": "..." }`.
7. Open the declared route/surface and visually inspect UI changes.
8. Check Extension Manager diagnostics before reporting done.

Starter create payload:

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "description": "One sentence about what this extension does.",
  "template": "main-page"
}
```

## Agent tool contract

Use the `extension_manager` tool when it is available. It is the built-app authoring loop and does not require a repo checkout.

```json
{ "action": "list" }
{ "action": "create", "id": "my-extension", "name": "My Extension", "description": "...", "template": "main-page" }
{ "action": "snapshot", "id": "my-extension" }
{ "action": "build", "id": "my-extension" }
{ "action": "validate", "id": "my-extension" }
{ "action": "reload", "id": "my-extension" }
{ "action": "validate", "packageRoot": "/absolute/path/to/uninstalled-extension" }
```

A validation result has this shape:

```json
{
  "ok": false,
  "extensionId": "my-extension",
  "packageRoot": "/.../extensions/my-extension",
  "summary": { "errors": 1, "warnings": 0, "info": 0 },
  "findings": [
    {
      "severity": "error",
      "code": "missing-frontend-dist",
      "message": "Frontend entry is missing: dist/frontend.js",
      "path": "/.../dist/frontend.js",
      "fix": "Build the extension."
    }
  ]
}
```

Treat `ok: false` as actionable, not fatal. Fix every `error`, usually fix every `warning`, rebuild, validate again, then reload.

## HTTP API contract

If tools are unavailable but the app API is reachable, use the same operations over HTTP:

```text
GET  /api/extensions/installed
POST /api/extensions
POST /api/extensions/{id}/snapshot
POST /api/extensions/{id}/build
POST /api/extensions/{id}/validate
POST /api/extensions/validate          # body: { id | extensionId | packageRoot }
POST /api/extensions/{id}/reload
POST /api/extensions/{id}/self-test
POST /api/extensions/{id}/export
```

Successful build response:

```json
{ "ok": true, "extensionId": "my-extension", "outputs": ["dist/frontend.js", "dist/backend.mjs"] }
```

Successful reload response:

```json
{ "ok": true, "id": "my-extension", "reloaded": true, "message": "Extension backend reloaded." }
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

## Build, validate, and reload

Built app path:

1. Build with the `extension_manager` tool `{ "action": "build", "id": "my-extension" }`, Extension Manager **Build**, or `POST /api/extensions/{id}/build`.
2. Validate with `{ "action": "validate", "id": "my-extension" }`. The doctor checks manifest references, dist files, stale output, frontend component exports, backend action exports, tool schemas, skill files, forbidden process imports, non-portable absolute imports, and backend module import crashes.
3. Reload with `{ "action": "reload", "id": "my-extension" }`, Extension Manager **Reload**, or `POST /api/extensions/{id}/reload`.
4. Inspect diagnostics in Extension Manager.

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
- `extension_manager { "action": "validate", "id": "..." }` returns `ok: true`, or every finding is understood and explicitly reported.
- Build/reload succeeded without Extension Manager diagnostics.
- Backend imports at module scope without throwing.
- No absolute, `file:`, release-temp, or machine-local imports remain in `dist/`.
- No direct process APIs are imported by backend source.
- UI surfaces open and look native.
- README explains what the extension does and how to use it.

## Quality bar for full-fledged extensions

A full-fledged extension should have more than a passing build. Check these before calling it done:

- **Clear product boundary**: README says what the extension owns, where its data lives, and how a user starts using it.
- **Native UI**: uses shared UI primitives and app theme tokens; no iframe/webview fallback, no isolated website styling.
- **Recoverable failures**: backend actions return useful errors, log with `ctx.log`, and avoid throwing from module scope.
- **Agent-safe tools**: tool names are stable, descriptions are action-oriented, schemas are precise, and destructive actions require explicit inputs.
- **State model**: user-visible config is in manifest settings; private runtime data is in extension storage; no secrets are written to source or README.
- **Portability**: dist bundles contain no machine-local paths and do not depend on repo-only packages.
- **Operations**: build, validate, reload, self-test, and export all behave predictably from Extension Manager.
- **Visual proof**: every contributed page, rail, workbench detail, modal, renderer, or settings component was opened and inspected.

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
