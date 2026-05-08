# Personal Agent Extension SDK

This package is the public import surface for native Personal Agent extensions. Extension code should import from `@personal-agent/extensions` and its subpath modules instead of reaching into `packages/desktop` internals.

## Manifest contract

Every extension package has an `extension.json` manifest. The desktop runtime validates the manifest before loading the extension, so malformed contributions fail fast instead of turning into mystery UI bugs.

Supported top-level fields:

- `schemaVersion`: currently `2`.
- `id`, `name`, `description`, `version`, `packageType`.
- `frontend`: native React bundle entry and optional styles.
- `backend`: backend module entry, backend actions, and optional agent lifecycle factory.
- `contributes`: views, nav, commands, keybindings, slash commands, mentions, skills, tools, transcript renderers, and settings metadata.
- `permissions`: declared capability intent.

## Public imports

Use these modules as the paved road:

```ts
import type { ExtensionManifest, ExtensionSurfaceProps } from '@personal-agent/extensions';
import { AppPageLayout, EmptyState, ToolbarButton } from '@personal-agent/extensions/ui';
import { api, useAppData } from '@personal-agent/extensions/data';
import { WorkbenchBrowserTab, WorkspaceExplorer } from '@personal-agent/extensions/workbench';
import { SettingsPage } from '@personal-agent/extensions/settings';
```

System backend extensions can also import internal backend primitives through the deliberate backend seam:

```ts
import { createScheduledTask } from '@personal-agent/extensions/backend';
```

If a system extension needs a host primitive that is not exported here, add it deliberately to this package. Do not import from `packages/desktop/ui/src/...` or `packages/desktop/server/...` directly.

## Dependencies

Extensions declare Node dependencies in their own `package.json`, not in `extension.json`. The manifest describes host contributions and capability intent; package installation and module resolution use normal npm metadata.

Use `dependencies` for runtime libraries the frontend or backend imports:

```json
{
  "type": "module",
  "dependencies": {
    "@personal-agent/extensions": "*",
    "some-runtime-lib": "^1.2.3"
  }
}
```

The host SDK import, `@personal-agent/extensions`, is provided by Personal Agent and should remain the paved-road dependency for extension APIs. Third-party libraries should be regular package dependencies so local builds and imported extension bundles can resolve them before bundling.

## Frontend surfaces

A frontend surface exports a React component referenced by `contributes.views[].component`:

```tsx
import type { ExtensionSurfaceProps } from '@personal-agent/extensions';

export function AgentBoardPage({ pa, context }: ExtensionSurfaceProps) {
  return <main>{context.extensionId}</main>;
}
```

The host provides `pa` for stable app capabilities: backend action invocation, extension storage, workspace files, runs, automations, browser state, and lightweight UI prompts.

## Backend actions

Backend extensions export handlers referenced by `backend.actions[].handler`. Frontend code calls them through `pa.extension.invoke(actionId, input)`. Agent tools can call the same backend action through manifest-declared tool contributions.

## Keybindings

Global and surface-scoped shortcuts are declared with `contributes.keybindings`. Users can remap, disable, and reset extension shortcuts through Keyboard settings. Global shortcuts dispatch host commands like `navigate:/path`, `commandPalette:files`, `rightRail:extensionId/surfaceId`, or `layout:workbench`.

## Agent integration

Extensions can contribute:

- `skills`: local skill folders used as agent context without copying into the vault.
- `tools`: agent tools backed by backend actions.
- `backend.agentExtension`: a pi lifecycle extension factory for provider hooks or session-level behavior.

Keep agent-facing instructions in the extension package README or extension-owned skill files so the package remains self-contained.
