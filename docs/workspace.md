# Workspace

The standalone Workspace file browser/editor has been removed from the desktop web UI.

Use your normal file tool for raw file work instead:

- VS Code / Cursor / Zed for editing
- Finder or your OS file manager for browsing
- Obsidian for note-centric vault browsing
- git in your terminal or editor for staging/commits

## Why it was removed

The in-app workspace was trying to be a general file browser, editor, diff viewer, and git client inside an app whose real strengths are conversations, durable pages, inbox, and automation.

In practice, external tools are better at file work, so the web UI no longer tries to duplicate them.

## What remains

A few workspace-aware pieces still exist behind the scenes:

- conversations still track a working directory
- folder picking still exists where cwd selection matters
- repo-aware context can still inform conversation state

But there is no longer a dedicated `/workspace/files` or `/workspace/changes` destination for day-to-day browsing/editing.

## Practical rule of thumb

Use `personal-agent` for:

- conversations
- reminders, wakeups, and inbox
- durable notes, skills, and tracked work
- automation and run orchestration

Use your editor or file manager for files.

## Related docs

- [Decision Guide](./decision-guide.md)
- [Conversations](./conversations.md)
- [Web UI Guide](./web-ui.md)
- [Command-Line Guide (`pa`)](./command-line.md)
