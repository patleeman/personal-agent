# Extensions Guide

Pi extensions add functionality to the agent runtime. `personal-agent` manages extension discovery from profile layers and auto-installs extension dependencies when needed.

## Discovery order

Extensions are discovered in layer order:

1. `profiles/shared/agent/extensions/*`
2. `profiles/<profile>/agent/extensions/*`
3. `~/.config/personal-agent/local/extensions/*`

Valid entrypoints:

- `extensions/<name>.ts` or `extensions/<name>.js`
- `extensions/<name>/index.ts` or `extensions/<name>/index.js`

Higher layer resources are appended after lower layers; path dedupe prevents duplicate entries.

---

## Typical structure

```text
extensions/
├── context-bar.ts
├── memory/
│   └── index.ts
├── web-tools/
│   └── index.ts
├── tmux-manager/
│   └── index.ts
├── tmux-orchestration-prompt/
│   └── index.ts
└── package.json   # optional shared deps for this extension root
```

---

## Entrypoint shape

```ts
import type { Pi } from '@mariozechner/pi-coding-agent';

export default function (pi: Pi) {
  pi.on('before_agent_start', (event) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\nCustom extension context`,
    };
  });
}
```

---

## Dependency auto-install

When `pa` launches Pi, it checks discovered extension dependency dirs.

If an extension directory (or extension root) has `package.json` but no `node_modules`, `pa` runs npm install before launching Pi.

This allows extension-specific dependencies to be self-contained.

---

## Built-in extensions in this repo

- `memory` — active-profile memory policy injection (`AGENTS.md` + `skills/` memory model)
- `context-bar` — session context display in Pi TUI
- `inbox-shell` — inbox/context widget + footer attention status + right-side overlay panel for TUI
- `pa-header` — appends personal-agent profile/AGENTS provenance to the startup header
- `at-autocomplete-performance` — replaces heavy `@` fuzzy file search with fast path-style completion in large repos
- `deferred-resume` — schedules this same TUI session to resume later after a delay; actual due/firing is daemon-backed when available
- `web-tools` — web search/fetch tool integration
- `tmux-manager` — `/tmux` command + footer status for agent-managed tmux sessions only
- `tmux-orchestration-prompt` — system-prompt tmux orchestration/status policy injection

---

## Memory extension behavior

`profiles/shared/agent/extensions/memory/` injects:

- active profile name
- profile directory metadata
- memory management policy (AGENTS + skills as durable memory)

This aligns agent behavior with profile-layer memory rules.

---

## Environment variables

Common extension-related env vars:

- `PERSONAL_AGENT_ACTIVE_PROFILE` — active profile name exposed at runtime
- `PERSONAL_AGENT_REPO_ROOT` — repo root for resolving profile paths

---

## Authoring tips

- Keep each extension focused on one concern
- Prefer `pi.on(...)` hooks over global mutable state
- Handle errors gracefully (avoid crashing agent startup)
- Document required env vars near extension source
- Test quickly with Pi `/reload` after edits

---

## Related docs

- [Profile Schema](./profile-schema.md)
- [CLI Guide](./cli.md)
- [Architecture](./architecture.md)
