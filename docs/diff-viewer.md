# Diff Viewer

The Diff Viewer displays git diffs for conversation checkpoints. It appears in the Diffs tab of the workbench rail when the conversation has saved checkpoints.

## How It Works

Each checkpoint stores a git commit SHA and the files it tracked. The Diff Viewer renders the diff for each file inline, showing what changed between the checkpoint and the current state (or between two checkpoints in review mode).

## Layout

```
┌─────────────────────────────────────┐
│ Diffs (2 checkpoints)               │
│                                     │
│ ┌─ Checkpoint: "Refactor auth" ───┐ │
│ │ Just now · 3 files, +45 -12     │ │
│ │                                 │ │
│ │ ┌─ src/auth.ts ───────────────┐ │ │
│ │ │ @@ -42,7 +42,7 @@          │ │ │
│ │ │ -old code                   │ │ │
│ │ │ +new code                   │ │ │
│ │ │ ...                         │ │ │
│ │ └─────────────────────────────┘ │ │
│ │                                 │ │
│ │ ┌─ src/auth.test.ts (collapsed)│ │ │
│ │ └─────────────────────────────┘ │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─ Checkpoint: "Add tests" ──────┐ │
│ │ 2h ago · 1 file, +23 -0        │ │
│ │ (collapsed)                     │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

## Collapse Behavior

| Checkpoint state     | File diffs                     |
| -------------------- | ------------------------------ |
| Active (most recent) | All files expanded by default  |
| Inactive             | All files collapsed by default |

Click a checkpoint header to expand/collapse all its files. Click an individual file header to toggle that file's diff.

## File Information

Each file entry shows:

- **File path** — relative path from repo root
- **Additions** — green `+N`
- **Deletions** — red `-N`
- **Diff content** — unified diff with line numbers

## Relationship to Checkpoints

Checkpoints are created from conversations using the checkpoint tool. Each checkpoint produces a real git commit. The Diff Viewer reads those commits and renders the per-file diffs.

See [Checkpoints](checkpoints.md) for creating and managing checkpoints.
