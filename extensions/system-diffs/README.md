# Diffs Extension

This extension owns the product behavior documented below. Keep extension-specific user and agent docs here so the implementation and documentation move together.

---

<!-- Source: docs/checkpoints.md -->

# Checkpoints

Checkpoints create targeted git commits tied to a conversation. They capture the state of selected files at a specific point, making it possible to review diffs, roll back changes, or branch later.

## Creating a Checkpoint

From a conversation, use the checkpoint tool or the save button in the workbench Diffs rail. Select the files or directories to include in the snapshot.

```json
// Agent tool call
{
  "action": "save",
  "message": "Refactor auth middleware",
  "paths": ["packages/core/src/auth.ts", "packages/core/src/auth.test.ts"]
}
```

Each checkpoint produces a real git commit in the repository.

## Checkpoint Data

Each checkpoint stores:

| Field       | Description                                            |
| ----------- | ------------------------------------------------------ |
| `id`        | Unique checkpoint identifier                           |
| `title`     | Checkpoint name or commit message                      |
| `commitSha` | Git commit hash                                        |
| `createdAt` | ISO timestamp                                          |
| `files`     | Array of tracked files with additions and deletions    |
| `anchor`    | The conversation message that triggered the checkpoint |

### File snapshot

```json
{
  "file": "packages/core/src/auth.ts",
  "additions": 45,
  "deletions": 12,
  "messageCount": 1
}
```

## Viewing Checkpoints

Checkpoints appear in the Diffs tab of the workbench rail. The list shows all checkpoints for the conversation, ordered by creation time.

Each checkpoint entry shows:

- Title or commit message
- Timestamp
- File count and change summary (additions/deletions)

Click a checkpoint to expand its files and view diffs.

## Workflow

Checkpoints let you experiment freely in a conversation and commit changes at meaningful points:

1. Work on code in a conversation
2. When you reach a good state, create a checkpoint
3. Continue working with the safety net of a saved state
4. Use the Diff Viewer to review what changed between checkpoints
5. If needed, roll back or branch from any checkpoint

Checkpoints are real git commits and appear in the repo's git history alongside manually created commits.

## Storage

Checkpoints are stored in the conversation state and linked to git commits. They survive conversation restarts and appear in the Diffs rail whenever the conversation is reopened.

---

<!-- Source: docs/diff-viewer.md -->

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

See [Checkpoints](../../docs/checkpoints.md) for creating and managing checkpoints.

---

<!-- Source: docs/git-integration.md -->

# Git Integration

Personal Agent uses git in several features. This page describes how each feature interacts with git and how they relate to each other.

## Checkpoints

Checkpoints create real git commits. When the agent or user saves a checkpoint:

1. Selected files are staged
2. A git commit is created with the checkpoint's message
3. The commit SHA, file list, and diff stats are stored in the conversation state
4. The commit appears in the repo's git history alongside manually created commits

Checkpoints are real git operations. They can be pushed, pulled, branched, and reverted using standard git commands outside the app.

See [Checkpoints](../../docs/checkpoints.md) and [Diff Viewer](../../docs/diff-viewer.md).

## Knowledge Base Sync

The KB sync feature uses git to synchronize vault content across machines:

1. A remote git repository is cloned to `<state-root>/knowledge-base/repo`
2. Local changes are tracked via a content-addressed snapshot
3. Sync operations pull remote changes and push local commits
4. The managed clone serves as the effective vault root

This is a separate git workflow from checkpoints — it manages vault content, not project code.

See [Knowledge Base Sync](../../docs/knowledge-base-sync.md).

## Diff Viewer

The Diff Viewer reads git commits created by checkpoints and renders per-file diffs. It uses standard git diff output:

- File paths relative to repo root
- Unified diff format with line numbers
- Addition/deletion counts per file

The diff viewer does not modify git state — it is read-only.

See [Diff Viewer](../../docs/diff-viewer.md).

## Release Cycle

Desktop releases use git tags for version tracking:

1. `npm version` creates a version commit and tag (e.g., `v0.6.0`)
2. The tag is pushed to the remote
3. A GitHub Release is created from the tag

See [Release Cycle](../../docs/release-cycle.md).

## Git Requirements

The app requires git to be installed and available in the system PATH for:

- Checkpoint creation (commits)
- Knowledge base sync (clone, pull, push)
- Diff viewing (diff)
- Release cycle (tag, push)

If git is not available, checkpoints and KB sync will not function. The rest of the app works normally.
