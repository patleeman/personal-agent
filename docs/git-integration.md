# Git Integration

Personal Agent uses git in several features. This page describes how each feature interacts with git and how they relate to each other.

## Checkpoints

Checkpoints create real git commits. When the agent or user saves a checkpoint:

1. Selected files are staged
2. A git commit is created with the checkpoint's message
3. The commit SHA, file list, and diff stats are stored in the conversation state
4. The commit appears in the repo's git history alongside manually created commits

Checkpoints are real git operations. They can be pushed, pulled, branched, and reverted using standard git commands outside the app.

See [Checkpoints](checkpoints.md) and [Diff Viewer](diff-viewer.md).

## Knowledge Base Sync

The KB sync feature uses git to synchronize vault content across machines:

1. A remote git repository is cloned to `<state-root>/knowledge-base/repo`
2. Local changes are tracked via a content-addressed snapshot
3. Sync operations pull remote changes and push local commits
4. The managed clone serves as the effective vault root

This is a separate git workflow from checkpoints — it manages vault content, not project code.

See [Knowledge Base Sync](knowledge-base-sync.md).

## Diff Viewer

The Diff Viewer reads git commits created by checkpoints and renders per-file diffs. It uses standard git diff output:

- File paths relative to repo root
- Unified diff format with line numbers
- Addition/deletion counts per file

The diff viewer does not modify git state — it is read-only.

See [Diff Viewer](diff-viewer.md).

## Release Cycle

Desktop releases use git tags for version tracking:

1. `npm version` creates a version commit and tag (e.g., `v0.6.0`)
2. The tag is pushed to the remote
3. A GitHub Release is created from the tag

See [Release Cycle](release-cycle.md).

## Git Requirements

The app requires git to be installed and available in the system PATH for:

- Checkpoint creation (commits)
- Knowledge base sync (clone, pull, push)
- Diff viewing (diff)
- Release cycle (tag, push)

If git is not available, checkpoints and KB sync will not function. The rest of the app works normally.
