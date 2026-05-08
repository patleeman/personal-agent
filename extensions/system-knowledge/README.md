# Knowledge Extension

This extension owns the Knowledge workbench surfaces and knowledge-file mention provider.

## What it contributes

- A right-rail **Knowledge** tree for browsing the local knowledge base.
- A paired workbench detail view for opening and editing knowledge files beside a conversation.
- A `knowledge-files` mention provider that adds notes, folders, and files to the conversation `@` menu.

## Runtime behavior

The extension renders native React surfaces declared in `extension.json`:

- `knowledge-tree` renders the right-rail browser.
- `knowledge-file` renders the workbench detail panel for the selected file.

The host provides the knowledge APIs and editor primitives through the extension frontend surface props and public extension imports. Keep knowledge UI changes here rather than adding new shell-specific knowledge panels.

## Permissions

The extension declares `knowledge:read` and `knowledge:write` because it browses and edits local knowledge-base files.
