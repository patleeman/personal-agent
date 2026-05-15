# Desktop App

The Electron desktop app is the primary Personal Agent operator UI. It hosts the React renderer, manages the local daemon lifecycle, and provides the full feature surface.

## Starting

```bash
# Stable production build
pnpm run desktop:start

# Development mode with hot reload
pnpm run desktop:dev

# Demo mode with seeded data
pnpm run desktop:demo
```

Both `desktop:start` and `desktop:dev` build the Electron shell and launch it through `packages/desktop/scripts/launch-dev-app.mjs`.

For packaged builds, launch `Personal Agent.app` from the output directory. RC builds launch as `Personal Agent RC.app` so they can coexist with the stable app.

## Runtime Model

```
Electron main process
    │
    ├── Renderer (React) ── personal-agent://app/
    │       │
    │       ├── Conversation routes
    │       ├── Knowledge
    │       ├── Automations
    │       └── Settings
    │
    ├── Local API worker threads
    │       │
    │       ├── Session parsing and search
    │       ├── Git/checkpoint operations
    │       └── Vault and knowledge-base reads/writes
    │
    ├── Daemon (in-process runtime)
    │       │
    │       ├── Runs
    │       ├── Scheduled tasks
    │       ├── Wakeups
    │       └── Reminders
```

- Electron owns the UI surface through the `personal-agent://app/` protocol
- Keep the startup path tiny: the main-process hot bundle should only create the window, register protocol/IPC, and schedule deferred work
- Freeze-prone local API work runs behind worker-thread RPC; do not import or execute heavy desktop server capabilities directly on the Electron main thread
- Avoid `spawnSync`/`execSync` in desktop main-process flows
- The daemon owns durable background behavior and starts after the renderer has had a chance to paint; user actions that need it can force-start it immediately
- The desktop app loads initial readonly snapshots first, then connects to server-pushed events for sessions, runs, tasks, and daemon status after startup settles

## Layout Modes

| Mode         | Shortcut | Description                          |
| ------------ | -------- | ------------------------------------ |
| Conversation | `F1`     | Single-pane layout with left sidebar |
| Workbench    | `F2`     | Multi-pane layout with side rails    |

Toggle the left sidebar with `Cmd+/` (or `Ctrl+/`). Toggle the right rail with `Cmd+\` (or `Ctrl+\`).

## Workbench Rails

In Workbench mode, the right rail nav tabs include:

| Tab           | Description                       |
| ------------- | --------------------------------- |
| File Explorer | Project file tree browser         |
| Diffs         | Checkpoint diffs and file changes |
| Artifacts     | Rendered HTML, Mermaid, LaTeX     |
| Runs          | Background runs and subagents     |
| Browser       | Embedded webview                  |

Knowledge is a primary left-sidebar page (not a workbench tab). Extension-contributed tool panels also appear in the nav. Tabs are context-sensitive — Diffs, Artifacts, and Runs only appear when the conversation has relevant data. Heavy workbench panels are lazy-loaded so they do not inflate the initial renderer bundle.

## Keyboard Shortcuts

All desktop shortcuts are configurable in Settings → Keyboard. Defaults:

| Action            | Default               |
| ----------------- | --------------------- |
| New conversation  | `Cmd+N`               |
| Conversation mode | `F1`                  |
| Workbench mode    | `F2`                  |
| Toggle sidebar    | `Cmd+/` (or `Ctrl+/`) |
| Toggle right rail | `Cmd+\` (or `Ctrl+\`) |
| Settings          | `Cmd+,`               |

## Routes

| Route                | Page                  |
| -------------------- | --------------------- |
| `/conversations`     | Conversation list     |
| `/conversations/new` | New conversation      |
| `/conversations/:id` | Existing conversation |
| `/knowledge`         | Knowledge browser     |
| `/automations`       | Scheduled task list   |
| `/automations/:id`   | Automation detail     |
| `/settings`          | Settings panel        |
| `/extensions`        | Extension Manager     |
| `/telemetry`         | Telemetry traces page |
| `/gateways`          | Gateway connections   |

## Demo Mode

`pnpm run desktop:demo` creates an isolated temporary state root with seeded conversations, automations, runs, and assets for UI development and testing. Seeded content includes conversations with artifacts, checkpoints, reminders, subagent demos, and pathological fixtures.
