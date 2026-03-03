# Extensions Guide

Pi extensions add functionality to the Pi coding agent. `personal-agent` manages extensions through profiles with auto-discovery and dependency installation.

## Extension Discovery

Extensions are discovered from profile layers in order:

1. `profiles/shared/agent/extensions/*`
2. `profiles/<profile>/agent/extensions/*`
3. `~/.config/personal-agent/local/extensions/*`

Valid entrypoints:
- `extensions/<name>.ts` or `extensions/<name>.js`
- `extensions/<name>/index.ts` or `extensions/<name>/index.js`

## Structure

```
extensions/
├── memory/
│   └── index.ts          # Active-profile memory policy
├── web-tools/
│   └── index.ts
└── package.json          # Shared dependencies (optional)
```

## Extension Entrypoint

Extensions export a function that receives the Pi SDK:

```typescript
// extensions/my-extension/index.ts
import type { Pi } from '@mariozechner/pi-coding-agent';

export default function (pi: Pi) {
  // Register hooks, tools, or handlers
  pi.on('before_agent_start', (event) => {
    // Modify context before agent starts
    return { systemPrompt: event.systemPrompt + '\n\nCustom context...' };
  });
}
```

## Dependency Auto-Installation

Extensions with `package.json` are auto-installed:

```json
{
  "name": "my-extension",
  "version": "1.0.0",
  "dependencies": {
    "some-package": "^1.0.0"
  }
}
```

On first use, `pa` will:
1. Detect the extension has dependencies
2. Run `npm install` in the extension directory
3. Cache success to avoid re-installing

## Built-in Extensions

### memory

Active-profile memory policy injection.

- Injects the active profile name and profile directory into the system prompt
- Instructs the agent to treat `AGENTS.md` and `skills/` as the memory system
- Grants the agent autonomy to manage AGENTS/skills for the active role

Location: `profiles/shared/agent/extensions/memory/`

### context-bar

Displays session context in Pi TUI.

### web-tools

Web search and integration capabilities.

### update

Self-update commands for `personal-agent`.

### background-bash

Background task execution utilities.

## Environment Variables

Extension behavior can be tuned via env vars:

| Variable | Description | Default |
|----------|-------------|---------|
| `PERSONAL_AGENT_ACTIVE_PROFILE` | Active profile exposed to the memory extension | `shared` |
| `PERSONAL_AGENT_REPO_ROOT` | Repo root used to resolve profile paths | inferred from extension path |

## Authoring Extensions

### Basic Template

```typescript
import type { Pi } from '@mariozechner/pi-coding-agent';

export default function (pi: Pi) {
  console.log('[my-extension] Loading...');
  
  // Hook into agent lifecycle
  pi.on('before_agent_start', (event) => {
    // Access: event.systemPrompt, event.cwd, event.sessionFile, etc.
    
    // Return modifications
    return {
      systemPrompt: event.systemPrompt + '\n\n[Extension context]'
    };
  });
}
```

### With Dependencies

```typescript
// extensions/my-extension/index.ts
import { somePackage } from 'some-package';
import type { Pi } from '@mariozechner/pi-coding-agent';

export default function (pi: Pi) {
  pi.on('before_agent_start', async (event) => {
    const result = await somePackage.process(event.cwd);
    
    return {
      systemPrompt: event.systemPrompt + `\n\nContext: ${result}`
    };
  });
}
```

```json
// extensions/my-extension/package.json
{
  "name": "my-extension",
  "version": "1.0.0",
  "dependencies": {
    "some-package": "^1.0.0"
  }
}
```

### Testing Extensions

Extensions are loaded when Pi starts via `pa tui`. Test by:

1. Adding extension to profile extensions directory
2. Running `pa tui` (dependencies auto-install)
3. Using `/reload` in Pi TUI to reload extensions without restart

## Debugging

Extension logs appear in Pi output. Use `console.log` sparingly:

```typescript
if (process.env.DEBUG_MY_EXTENSION) {
  console.log('[my-extension] Debug:', data);
}
```

## Best Practices

- Keep extensions focused on one responsibility
- Use `pi.on()` hooks rather than modifying global state
- Handle errors gracefully (don't crash Pi)
- Document required env vars in extension README
- Version dependencies conservatively
- Test with `/reload` before committing
