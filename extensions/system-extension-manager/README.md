# Extension Manager Extension

This extension owns the UI and operations for discovering, creating, building, reloading, enabling, disabling, importing, exporting, and inspecting Personal Agent native extensions.

For the extension authoring contract, read [`packages/extensions/README.md`](../../packages/extensions/README.md) in a repo checkout, or use the packaged `local-extension-development` skill when operating from the built app. Those are the source of truth for agents building extensions: package layout, manifests, frontend/backend APIs, dependencies, skills, tools, storage, permissions, and the build loop. Do not duplicate that contract here.

## Product direction

Extensions are Personal Agent's native product-module system. They let Patrick or an agent add app functionality without editing the core shell for every workflow.

The old iframe/HTML extension model is deprecated. New extensions render native React inside the Personal Agent UI, declare their surfaces in `extension.json`, call stable PA capabilities from `@personal-agent/extensions`, and use separate frontend/backend entries.

The Extension Manager should make that loop boring:

- create a starter native extension package
- list installed system and user extensions
- show manifest, surfaces, commands, routes, build status, and permissions
- build/rebuild an extension
- reload extension registry/runtime
- keep per-extension actions visibly acknowledged with inline progress and result notices even when the list is scrolled
- enable/disable user extensions without replacing the Extension Manager page; registry-backed navigation and surfaces refresh in place
- export/import extension packages
- snapshot a user extension before agent edits
- open an extension folder in Finder/editor
- expose an agent-facing `extension_manager` tool for list/create/snapshot/build/validate/reload
- show build/runtime errors in a way an agent can fix

## Operational model

User extensions live in runtime state by default:

```text
~/.local/state/personal-agent/extensions/{extension-id}/
```

Bundled first-party extensions live in the repo/app bundle under `extensions/` and use the same extension contract. They are discovered by the same package-path scanner as user extensions; there is no hard-coded system extension allowlist.

The loader also includes repo-local experimental extensions from `experimental-extensions/extensions/` as external extension packages. They should declare `defaultEnabled: false`, which keeps them visible in Extension Manager's collapsed Experimental section without registering routes/tools until enabled.

The loader scans the default runtime install location `<state-root>/extensions`. Users can add more package roots or parent folders through the `extensions.additionalPaths` setting exposed by this extension; entries may be comma- or newline-separated. The loader also accepts package roots through `PERSONAL_AGENT_EXTENSION_PATHS` for process-level overrides.

Extension Manager can build runtime extensions in-app when running from an unpackaged/dev desktop bundle. Use the per-extension **Build** action or the `extension_manager` tool's `build` action to compile `src/frontend.tsx` and `src/backend.ts` into manifest-declared `dist/*` entries, then **Reload** / `reload` to refresh backend modules and registry surfaces. Use `validate` after each build; the extension doctor checks manifest references, dist files, stale output, frontend/backend exports, service handlers, tool schemas, skill files, forbidden process imports, non-portable bundled imports, and backend import crashes. Packaged desktop releases are prebuilt-only: they load existing `dist/` bundles and reject runtime compilation. Starter creation supports three templates: `main-page`, `right-rail`, and `workbench-detail`; richer examples for services, subscriptions, selection actions, transcript blocks, and dependencies live in the packaged `local-extension-development` skill.

## Agent workflow for this extension

When modifying Extension Manager itself:

1. Keep product behavior docs here and authoring/API contract docs in `packages/extensions/README.md`.
2. Inspect `packages/desktop/server/extensions/*` before changing lifecycle, registry, manifest, import/export, or build behavior.
3. Inspect `packages/desktop/ui/src/extensions/*` before changing native surface hosting, registry state, or extension UI.
4. If a first-party extension needs a new stable host primitive, add it deliberately to `packages/extensions` instead of importing app internals.
5. Validate create/build/reload flows after changes.
6. Visually inspect the Extension Manager UI before reporting done.

## Migration stance

Do not create new iframe `frontend/*.html` surfaces. If old iframe extension files remain during migration, treat them as legacy code to replace, not examples to copy.

Artifacts remain the sketchpad for generated reports, previews, and custom throwaway UI. Extensions are native product modules.

Preferred split: core records and serves cross-cutting state; native extensions own product surfaces.

## Migrated system extensions

Native system extensions include:

- `system-automations` owns `/automations` and scheduled/conversation-bound automation UI.
- `system-gateways` owns `/gateways` while the core app keeps gateway state and APIs.
- `system-telemetry` owns `/telemetry` while telemetry collection remains core infrastructure.
- `system-files` owns the workspace File Explorer rail and paired workbench file detail view while workspace filesystem APIs remain core infrastructure.
- `system-diffs` owns the conversation Diffs rail and paired workbench detail view while checkpoint persistence remains core infrastructure.
- `system-runs` owns the conversation Runs rail and paired workbench detail view while durable run execution remains core infrastructure.
- `system-settings` owns deep links for first-party settings subpanels while settings persistence remains core infrastructure.

## View placement model

Native extension views declare host intent with `placement`, `scope`, and `activation`.

- `placement: "primary"` — stable left-sidebar destination plus main page route. Use for global app pages like Automations, Gateways, Telemetry, Settings, Extensions, and standalone Knowledge.
- `placement: "workbench-tool"` — right rail tool, usually with a paired workbench detail pane. Use for side-by-side surfaces like Knowledge tree/editor, Browser tabs, File Explorer, Diffs, Runs, and Artifacts.

`scope` binds the view data: `global`, `workspace`, or `conversation`. `activation` controls lifecycle: `on-route` for routed pages, `on-open` for rail surfaces, `always` only for tiny host services, and `on-demand` for backend/tool-only work.

## Implementation checklist

Target order:

1. Keep manifest schema v2 and public types in `@personal-agent/extensions` current.
2. Keep `npm run extension:build -- <extension-dir>` working for frontend/backend bundles.
3. Keep native `ExtensionSurfaceHost` lazy-loading extension frontend bundles.
4. Keep scoped CSS loading with extension root, reset boundary, theme tokens, and cascade layer.
5. Keep typed `pa` surface props and PA UI components/hooks stable.
6. Wire manifest `views`, `nav`, commands, slash commands, skills, tools, and settings through registry surfaces.
7. Migrate system product surfaces to native extensions.
8. Remove legacy iframe extension UI runtime and starter HTML templates when no longer needed.
9. Keep Extension Manager build/reload/status flows agent-fixable.
10. Backfill tests around manifest parsing, lazy loading, action invocation, CSS scoping, and system extension migrations.
