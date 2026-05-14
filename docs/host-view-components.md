# Host view components

Host view components let an extension mount common Personal Agent workbench UI without bundling the host implementation into the extension frontend.

Use a string `component` when the extension owns the React component. Use an object `component` with a `host` id when the host owns the renderer. A host-only view does not load the extension frontend entry for that surface.

```json
{
  "id": "artifact-detail",
  "location": "workbench",
  "component": {
    "host": "workbench.artifacts.detail"
  }
}
```

To customize a host component later, add `props` for supported JSON-serializable options. The manifest shape also reserves `override` for extension-owned slot/wrapper exports; host components without an override stay fully host-rendered.

Available host components:

- `workbench.artifacts.rail` / `workbench.artifacts.detail`
- `workbench.diffs.rail` / `workbench.diffs.detail`
- `workbench.files.rail` / `workbench.files.detail`
- `workbench.runs.rail` / `workbench.runs.detail`
- `workbench.browser.rail` / `workbench.browser.detail`

The runtime registry lives in `packages/desktop/ui/src/extensions/hostViewComponents.tsx`; manifest validation accepts only the ids listed in `EXTENSION_HOST_VIEW_COMPONENTS` in `packages/desktop/server/extensions/extensionManifest.ts`.
