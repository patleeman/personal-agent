# Host view components

Host view components let an extension reuse Personal Agent workbench UI without bundling or cloning the host implementation.

Use a string `component` when the extension owns the full React surface. Use an object `component` with a `host` id when the host owns the renderer. A host-only view does not load the extension frontend entry for that surface.

```json
{
  "id": "artifact-detail",
  "location": "workbench",
  "component": {
    "host": "workbench.artifacts.detail"
  }
}
```

## Customization model

Host components have explicit JSON `props` and named override slots. The first supported slot on every host view component is `wrapper`.

```json
{
  "id": "artifact-detail",
  "location": "workbench",
  "component": {
    "host": "workbench.artifacts.detail",
    "props": {},
    "overrides": {
      "wrapper": "CustomArtifactDetailWrapper"
    }
  }
}
```

The wrapper export receives the normal extension surface props plus `HostComponent`, `hostProps`, and `slotOverrides`:

```tsx
import type { ExtensionSurfaceProps } from '@personal-agent/extensions';

type HostWrapperProps = ExtensionSurfaceProps & {
  HostComponent: React.ComponentType<ExtensionSurfaceProps>;
  hostProps?: Record<string, unknown>;
  slotOverrides?: Record<string, React.ComponentType<ExtensionSurfaceProps>>;
};

export function CustomArtifactDetailWrapper({ HostComponent, ...props }: HostWrapperProps) {
  return (
    <div className="h-full">
      <HostComponent {...props} />
    </div>
  );
}
```

`override` is accepted as a legacy shorthand for `overrides.wrapper`, but new manifests should use `overrides`.

## Available host components

The canonical catalog lives in `@personal-agent/extensions/host-view-components` and is used by runtime validation, UI loading, docs, and extension-manager tooling.

Current ids:

- `workbench.artifacts.rail` / `workbench.artifacts.detail`
- `workbench.diffs.rail` / `workbench.diffs.detail`
- `workbench.files.rail` / `workbench.files.detail`
- `workbench.runs.rail` / `workbench.runs.detail`
- `workbench.browser.rail` / `workbench.browser.detail`

Agents can inspect the catalog with:

```json
{
  "action": "hostViewComponents"
}
```

through the `extension_manager` tool.

## Runtime split

- Host component references load from `packages/desktop/ui/src/extensions/hostViewComponents.tsx`.
- Custom string components still load the extension frontend entry.
- Host references with overrides load the host component and then load only the extension override exports.
- Server manifest validation rejects unknown host ids and unknown override slots before the UI can render a broken surface.
