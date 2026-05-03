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
