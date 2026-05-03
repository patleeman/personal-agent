# File Explorer

The File Explorer is a file tree browser in the workbench rail. It provides quick access to workspace and vault files without leaving the conversation.

## Opening the Explorer

In Workbench mode, the File Explorer tab is available in the right rail. Click the Files icon to open it. The tree shows the project directory structure.

## Navigation

- **Expand** — click a folder to expand its contents
- **Select** — click a file to select it (preview in the editor pane)
- **Right-click** — context menu with actions (copy path, reveal in Finder)

The tree follows the filesystem. Directories that match common ignore patterns (node_modules, .git) may be excluded from the view.

## Integration with the Composer

### @-references

Type `@` in the composer to open a fuzzy-search overlay. Start typing a filename and matching files from the workspace appear. Select one to insert a file reference that the agent can read.

### Drag and drop

Drag files from the File Explorer into the composer to attach them to the message. The file content is included in the prompt.

## File Picker Dialog

The file picker is a modal dialog for selecting files. It supports:

- Directory navigation
- File type filtering
- Multi-select
- Recent files list

Used by checkpoints (file selection), project setup, and other file-related operations.

## Folder Picker Dialog

The folder picker is a modal dialog for selecting directories. Used for:

- Checkpoint scope selection
- Change working directory target
- Project root selection

## Workspace Explorer

The workspace explorer shows the full project directory tree. It combines:

- Workspace files (local filesystem)
- Vault files (knowledge base)
- Project files (when a project is active)

The tree updates when files are created, modified, or deleted outside the app.
