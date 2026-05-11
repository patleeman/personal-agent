# Desktop App

The Electron desktop app is the primary Personal Agent operator UI. It hosts the React renderer, manages the local daemon lifecycle, and provides the full feature surface.

## Starting

```bash
# Stable production build
npm run desktop:start

# Development mode with hot reload
npm run desktop:dev

# Demo mode with seeded data
npm run desktop:demo
```

Both `desktop:start` and `desktop:dev` build the Electron shell and launch it through `packages/desktop/scripts/launch-dev-app.mjs`.

For packaged builds, launch `Personal Agent.app` from the output directory.

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
    │       ├── Companion API
    │       └── Reminders
    │
    └── Companion API server (HTTP/WebSocket)
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

Switch between Conversation and Workbench with `Cmd+Option+\`. Toggle the left sidebar with `Cmd+\`. Toggle the right rail with `Cmd+Shift+\`.

## Workbench Rails

In Workbench mode, the right rail provides configurable tabs:

| Tab           | Description                       |
| ------------- | --------------------------------- |
| Knowledge     | Browse and edit vault files       |
| File Explorer | Project file tree browser         |
| Diffs         | Checkpoint diffs and file changes |
| Artifacts     | Rendered HTML, Mermaid, LaTeX     |
| Browser       | Embedded webview                  |

Tabs are context-sensitive — Diffs and Artifacts only appear when the conversation has checkpoint or artifact data. Heavy workbench panels are lazy-loaded so they do not inflate the initial renderer bundle.

## Keyboard Shortcuts

All desktop shortcuts are configurable in Settings. Defaults:

| Action             | Default        |
| ------------------ | -------------- |
| New conversation   | `Cmd+N`        |
| Toggle sidebar     | `Cmd+\`        |
| Toggle workbench   | `Cmd+Option+\` |
| Toggle right rail  | `Cmd+Shift+\`  |
| Settings           | `Cmd+,`        |
| Toggle layout mode | `F1`/`F2`      |

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

## Demo Mode

`npm run desktop:demo` creates an isolated temporary state root with seeded conversations, automations, runs, and assets for UI development and testing. Seeded content includes conversations with artifacts, checkpoints, reminders, subagent demos, and pathological fixtures.
