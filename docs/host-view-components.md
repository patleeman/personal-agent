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

## When to use this

Use a host component when the extension wants standard Personal Agent UI behavior and only needs small customization. Keep a string component when the extension owns a genuinely custom surface.

This split keeps the extension manifest as the routing/contribution layer while the host owns reusable UI primitives. The win is not just smaller initial bundles; it also removes cloned workbench panels that drift and break independently.

## Component forms

### Extension-owned component

```json
{
  "id": "custom-artifact-detail",
  "location": "workbench",
  "component": "CustomArtifactDetailPanel"
}
```

The UI loads the extension frontend entry and resolves `CustomArtifactDetailPanel` from that module.

### Host-owned component

```json
{
  "id": "artifact-detail",
  "location": "workbench",
  "component": {
    "host": "workbench.artifacts.detail"
  }
}
```

The UI loads the host renderer from `packages/desktop/ui/src/extensions/hostViewComponents.tsx`. The extension frontend is not loaded for this surface unless the manifest also declares overrides.

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

## Migration example

Before host components, an extension that wanted to slightly change the artifact detail pane had to own the whole workbench component:

```json
{
  "frontend": {
    "entry": "dist/frontend.js",
    "styles": []
  },
  "contributes": {
    "views": [
      {
        "id": "artifact-detail",
        "title": "Artifact",
        "location": "workbench",
        "component": "ArtifactDetailPanel",
        "scope": "conversation",
        "activation": "on-demand"
      }
    ]
  }
}
```

That component then imported the workbench SDK, artifact data hooks, renderers, markdown/code renderers, and local layout code. It worked, but every extension that did this carried its own copy of a complex UI path. Tiny customizations became giant bundle and maintenance cliffs. Classic haunted house architecture, but with React.

After host components, the extension keeps the contribution but delegates the view to the host:

```json
{
  "frontend": {
    "entry": "dist/frontend.js",
    "styles": []
  },
  "contributes": {
    "views": [
      {
        "id": "artifact-detail",
        "title": "Artifact",
        "location": "workbench",
        "component": {
          "host": "workbench.artifacts.detail",
          "overrides": {
            "wrapper": "ArtifactDetailWrapper"
          }
        },
        "scope": "conversation",
        "activation": "on-demand"
      }
    ]
  }
}
```

The extension frontend now only needs the customization wrapper:

```tsx
import type { ExtensionSurfaceProps } from '@personal-agent/extensions';

type ArtifactDetailWrapperProps = ExtensionSurfaceProps & {
  HostComponent: React.ComponentType<ExtensionSurfaceProps>;
};

export function ArtifactDetailWrapper({ HostComponent, ...props }: ArtifactDetailWrapperProps) {
  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      <div className="border-b border-default px-4 py-2 text-sm text-secondary">Custom artifact controls</div>
      <HostComponent {...props} />
    </div>
  );
}
```

If there is no customization, remove `frontend` entirely when no other contribution needs it and use only the host reference.

## Available host components

The canonical catalog lives in `@personal-agent/extensions/host-view-components` and is used by runtime validation, UI loading, docs, and extension-manager tooling.

| Host id                      | Title                  | Locations   | Props | Override slots |
| ---------------------------- | ---------------------- | ----------- | ----- | -------------- |
| `workbench.artifacts.rail`   | Artifacts rail         | `rightRail` | none  | `wrapper`      |
| `workbench.artifacts.detail` | Artifact detail        | `workbench` | none  | `wrapper`      |
| `workbench.diffs.rail`       | Diffs rail             | `rightRail` | none  | `wrapper`      |
| `workbench.diffs.detail`     | Diff detail            | `workbench` | none  | `wrapper`      |
| `workbench.files.rail`       | Workspace files rail   | `rightRail` | none  | `wrapper`      |
| `workbench.files.detail`     | Workspace file detail  | `workbench` | none  | `wrapper`      |
| `workbench.runs.rail`        | Background work rail   | `rightRail` | none  | `wrapper`      |
| `workbench.runs.detail`      | Background work detail | `workbench` | none  | `wrapper`      |
| `workbench.browser.rail`     | Browser rail           | `rightRail` | none  | `wrapper`      |
| `workbench.browser.detail`   | Browser detail         | `workbench` | none  | `wrapper`      |

Agents can inspect the catalog with:

```json
{
  "action": "hostViewComponents"
}
```

through the `extension_manager` tool once the extension tool schema has been regenerated/reloaded in the running app.

## Runtime split

- Host component references load from `packages/desktop/ui/src/extensions/hostViewComponents.tsx`.
- Custom string components still load the extension frontend entry.
- Host references with overrides load the host component and then load only the extension override exports.
- Server manifest validation rejects unknown host ids and unknown override slots before the UI can render a broken surface.

## Adding a new host component

1. Add metadata to `packages/extensions/src/host-view-components.ts`.
2. Add the UI loader in `packages/desktop/ui/src/extensions/hostViewComponents.tsx`.
3. If the component needs configuration, define JSON-serializable `propsSchema` in the catalog.
4. If it needs customization, add named override slots to the catalog and make the host component read `slotOverrides`.
5. Update this doc's catalog table.
6. Run `pnpm run build:extensions`, `pnpm run check:extensions:quick`, `pnpm run check:types`, and `pnpm --dir packages/desktop run build:ui`.
