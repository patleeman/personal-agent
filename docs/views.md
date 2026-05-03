# Views

Personal Agent has three view modes. Switch between them with `F1`/`F2`/`F3` or the dropdown in the top bar.

## Conversation View (F1)

The default layout. A single conversation pane with a sidebar for thread navigation.

```
┌────────────────────────────────────┐
│ Sidebar │                          │
│          │   Transcript            │
│ ┌──────┐ │   ┌──────────────────┐  │
│ │Conv 1│ │   │ User message     │  │
│ │Conv 2│ │   │                  │  │
│ │Conv 3│ │   │ Assistant resp.  │  │
│ └──────┘ │   └──────────────────┘  │
│          │   ┌──────────────────┐  │
│          │   │ Composer         │  │
│          │   └──────────────────┘  │
└────────────────────────────────────┘
```

- **Left sidebar** — conversation list, toggle with `Cmd+\`
- **Center** — transcript and composer
- Use this for focused single-thread work

## Workbench View (F2)

A multi-pane layout for working alongside knowledge and tools. Available on conversation routes.

```
┌──────────────────────────────────────────────────────┐
│ Sidebar │  Transcript         │  Right rail          │
│          │                    │                      │
│ ┌──────┐│  ┌──────────────┐  │  ┌──────────────────┐│
│ │Conv 1││  │ User msg     │  │  │ Knowledge/Files/ ││
│ │Conv 2││  │              │  │  │ Diffs/Artifacts/ ││
│ │Conv 3││  │ Assistant    │  │  │ Browser          ││
│ └──────┘│  └──────────────┘  │  └──────────────────┘│
│          │  ┌──────────────┐  │                      │
│          │  │ Composer     │  │                      │
│          │  └──────────────┘  │                      │
└──────────────────────────────────────────────────────┘
```

The right rail shows configurable tabs:

| Tab           | Shows when                           |
| ------------- | ------------------------------------ |
| Knowledge     | Always — browse and edit vault files |
| File Explorer | Always — project file tree           |
| Diffs         | Conversation has checkpoints         |
| Artifacts     | Conversation has rendered artifacts  |
| Browser       | Opened by user                       |

Toggle the right rail with `Cmd+Shift+\`. Switch between Conversation and Workbench with `Cmd+Option+\`.

### Rail pane behavior

- Panes are resizable by dragging the divider
- The Knowledge pane shows the active note or vault browser
- The File Explorer shows the workspace file tree
- Diffs are collapsed per-file for inactive checkpoints, expanded for the active one
- Artifacts render inline (HTML, Mermaid, LaTeX)
- Browser loads pages alongside the conversation

## Zen View (F3)

Full-screen reading mode. All chrome is hidden — sidebar, rails, composer, top bar.

```
┌────────────────────────────────────┐
│                                    │
│   ┌────────────────────────────┐  │
│   │                            │  │
│   │  Transcript only           │  │
│   │  No sidebar                │  │
│   │  No rails                  │  │
│   │  No composer               │  │
│   │                            │  │
│   └────────────────────────────┘  │
│                                    │
└────────────────────────────────────┘
```

Use Zen for reviewing long conversation histories without distractions. Press `F3` or Escape to exit.

## Layout Shortcuts

| Action                        | Shortcut       |
| ----------------------------- | -------------- |
| Toggle Conversation/Workbench | `Cmd+Option+\` |
| Toggle sidebar                | `Cmd+\`        |
| Toggle right rail             | `Cmd+Shift+\`  |
| Conversation mode             | `F1`           |
| Workbench mode                | `F2`           |
| Zen mode                      | `F3`           |
