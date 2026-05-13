---
name: local-extension-development
description: Use when creating, editing, building, validating, reloading, importing, or debugging Personal Agent native extensions from inside the built app.
metadata:
  id: local-extension-development
  title: Local Extension Development
  summary: Built-in workflow for agents building native extensions with packaged app resources and Extension Manager APIs.
  status: active
---

# Local Extension Development

Use this skill when an agent is asked to build or fix a Personal Agent extension locally. It is packaged with the built app, so prefer it over repo-only source docs or scripts when operating from an installed desktop app.

## Ground rules

- Build native extensions, not iframe/webview extensions.
- Treat `src/` as source of truth and `dist/` as generated output.
- Use `@personal-agent/extensions` and documented SDK subpaths; do not import from `packages/desktop/*` or other repo internals.
- Use Extension Manager APIs/UI for create, build, reload, snapshot, import, export, enable, and disable.
- If working in a repo checkout, source scripts are allowed as fallbacks; if working in a built app, assume the repo and `pnpm` may not exist.

## Built-app workflow

1. Inspect installed extensions through Extension Manager or `GET /api/extensions/installed`.
2. Create a starter package with `POST /api/extensions` when starting new work.
3. Snapshot an existing user extension before edits with Extension Manager's snapshot action.
4. Edit the extension package under the runtime extensions root reported by Extension Manager.
5. Build with `POST /api/extensions/{id}/build` or the Extension Manager **Build** action.
6. Reload with `POST /api/extensions/{id}/reload` or the Extension Manager **Reload** action.
7. Open the contributed route/surface and visually inspect UI changes.
8. Check Extension Manager diagnostics for missing entries, import failures, or manifest errors.

Starter create payload:

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "description": "What this extension does.",
  "template": "main-page"
}
```

Supported templates are `main-page`, `right-rail`, and `workbench-detail`.

## Repo-checkout workflow

When a repo checkout is available, the same contract can be driven from the command line:

```bash
node scripts/extension-build.mjs /path/to/extension
node scripts/check-packaged-extensions.mjs
```

If `pnpm` is available, these wrappers are also valid:

```bash
pnpm run extension:build -- /path/to/extension
pnpm run check:extensions
pnpm run check:extensions:quick
```

Do not rely on these commands inside the installed app unless the repo checkout is explicitly present.

## Minimum package shape

```text
my-extension/
  extension.json
  package.json
  README.md
  src/
    frontend.tsx
    backend.ts
  dist/
    frontend.js
    backend.mjs
```

`extension.json` declares contributions. Frontend views point to named exports in `src/frontend.tsx`; backend actions point to named exports in `src/backend.ts`.

## Dependencies

Declare extension-owned dependencies in the extension's `package.json`. The builder bundles normal third-party dependencies into `dist/`. Host packages such as `@personal-agent/extensions`, `react`, and `react-dom` are provided by the app.

If a dependency is missing during build, install it in the extension directory when package tooling is available, then rebuild. If package tooling is unavailable in the built app, avoid adding new dependencies or vendor a small implementation in source.

## Debugging checklist

- `Failed to fetch dynamically imported module .../dist/frontend.js`: build output is missing or stale; rebuild and reload.
- Backend action/tool disappears: check Extension Manager diagnostics and backend logs for import failure.
- `Cannot find module` with an absolute temp path: bundle contains a non-portable import; rebuild with the app builder and avoid externalizing app internals.
- Handler not found: manifest action `handler` does not match a named backend export.
- Component not found: manifest component name does not match a named frontend export.
- Direct process APIs blocked: use backend `ctx.shell` / `ctx.git` so host execution wrappers and sandbox policy apply.

## References packaged with the app

Read these packaged resources when details matter:

- `docs/extensions.md` for the full native extension contract.
- `packages/extensions/README.md` when a repo checkout is available; otherwise use the packaged Extension API docs surfaced in the app docs.
- `extensions/system-extension-manager/README.md` for Extension Manager operations.
- Existing system extension READMEs for examples of tools, pages, rails, settings, skills, and backend actions.
