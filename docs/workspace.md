# Workspace

The old in-app workspace file browser/editor has been removed from the desktop web UI.

Use your normal file tools instead:

- VS Code / Cursor / Zed for editing
- Finder or your OS file manager for browsing
- git in your terminal or editor for staging and history
- Obsidian if you want a vault-oriented browser for notes

## Why

The in-app workspace tried to be a file browser, editor, diff viewer, and git client inside a product whose main strengths are conversations, durable knowledge, reminders, and automation.

External tools are better for raw file work, so the product no longer tries to duplicate them.

## What remains

A few workspace-aware pieces still exist:

- conversations still track a working directory
- folder picking still exists where cwd matters
- file mentions and repo-aware context still inform conversation state
- settings still expose workspace and vault information, with folder pickers for local path fields

But there is no dedicated day-to-day `/workspace/files` or `/workspace/changes` surface anymore.

## Practical rule

Use `personal-agent` for:

- conversations
- reminders and async attention
- durable notes, skills, and tracked work
- runs, scheduled tasks, and other automation

Use your editor or terminal for files.

## Related docs

- [Conversations](./conversations.md)
- [Web UI Guide](./web-ui.md)
