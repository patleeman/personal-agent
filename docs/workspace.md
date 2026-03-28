# Workspace

The Workspace is `personal-agent`'s repo-aware local file browser and editor.

Use it when you want to inspect or edit files in the current codebase through the web UI instead of dropping into another editor immediately.

## What the workspace is for

Good fits:

- browsing the current repo tree
- opening and editing text files
- jumping to changed files from git status
- inspecting diffs for the selected file
- staging, unstaging, and committing git-backed changes from the UI
- previewing supported assets such as common image types

The workspace is an interface over local files. It is not itself a durable knowledge surface like projects, notes, or skills.

## Rooting behavior

The workspace starts from the current cwd for the conversation or page context.

If that selected folder lives inside a git repo, the workspace automatically roots itself at the repo top level so that:

- the file tree matches git reality
- changed files line up with the repo root
- branch and status information stay coherent

If the selected folder is not inside a git repo, the workspace falls back to a filesystem tree rooted at the chosen directory.

## What you can do

In the web UI Workspace page you can:

- browse a file tree from the right rail
- open a file in the main editor pane
- inspect the file's original content and diff when relevant
- jump straight to changed files from git status
- stage or unstage git-backed changes
- create a commit from staged changes
- open the same workspace in VS Code when you want a fuller editor

## Git behavior

When the workspace is rooted inside a git repo, it exposes repo-aware operations such as:

- branch display
- changed/staged/unstaged counts
- per-file staged or unstaged diff views
- stage one file
- unstage one file
- stage all
- unstage all
- commit staged changes

Commits require:

- no unresolved conflicts
- at least one staged change

The workspace is intentionally repo-aware rather than trying to be a general VCS abstraction.

## File safety boundary

Workspace file access is sandboxed to the resolved workspace root.

Paths outside that root are rejected.

That means the workspace is safe to use as a local editing surface without letting arbitrary relative paths escape above the selected root.

## Preview behavior

The workspace can preview supported asset types directly in the UI.

For text files, it shows content plus diff context when available.
For supported previewable assets, it can open a preview rather than raw binary content.

## Live updates

Workspace updates participate in the web UI's live-update model.

In practice that means:

- file tree and changed-file state update live
- git-backed workspace changes can invalidate the workspace view without a full page reload
- the UI still keeps manual refresh paths available if needed

## Relationship to conversations

The workspace usually follows the effective cwd of the conversation or selected repo context.

That means project references and cwd selection influence which repo the workspace opens against, but the workspace itself remains a file interface, not the durable home of the conversation.

## Practical rule of thumb

Use the workspace to work on files.

Use projects, notes, skills, or artifacts when the result needs a durable conceptual home beyond the raw file edit.

## Related docs

- [Decision Guide](./decision-guide.md)
- [Conversations](./conversations.md)
- [Projects](./projects.md)
- [Web UI Guide](./web-ui.md)
- [Command-Line Guide (`pa`)](./command-line.md)
