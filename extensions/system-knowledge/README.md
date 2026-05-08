# Knowledge Extension

This extension owns the Knowledge workbench surfaces and knowledge-file mention provider.

## What it contributes

- A left-nav **Knowledge** destination backed by the native `knowledge-page` extension view.
- A right-rail **Knowledge** tree for browsing the local knowledge base.
- A paired workbench detail view for opening and editing knowledge files beside a conversation.
- A `knowledge-files` mention provider that adds notes, folders, and files to the conversation `@` menu.
- A quick-open provider for command-palette file open/search.
- A prompt-reference resolver that turns `@knowledge-file.md` mentions into hidden prompt context.

## Runtime behavior

The extension renders native React surfaces declared in `extension.json`:

- `knowledge-page` renders the main `/knowledge` page with its own file tree and editor.
- `knowledge-tree` renders the right-rail browser.
- `knowledge-file` renders the workbench detail panel for the selected file.

The extension also owns backend actions for knowledge state, managed sync, vault file operations, and prompt-reference resolution:

- `readState` reads configured repository/sync status.
- `updateState` updates the managed knowledge repository configuration.
- `sync` runs a git-backed knowledge-base sync and invalidates knowledge UI state.
- `vault*` actions list, read, write, search, move, rename, delete, import, and upload knowledge files.
- `resolvePromptReferences` resolves knowledge file mentions during prompt submission.

Knowledge UI should stay in this extension. Host code may render contributed surfaces, but it should not add shell-specific Knowledge pages or file-search paths.

## Vault resolution

The vault is the root directory for durable knowledge. It resolves in this order:

1. `PERSONAL_AGENT_VAULT_ROOT` environment variable
2. Managed knowledge-base mirror at `<state-root>/knowledge-base/repo` when `knowledgeBaseRepoUrl` is configured
3. Legacy `vaultRoot` config value in `<config-root>/config.json`
4. `~/Documents/personal-agent`

## Vault contents

Instruction files are markdown files that define standing behavior and policy for the agent. They are selected in Settings or listed in config:

```json
{
  "instructionFiles": ["instructions/base.md", "instructions/code-style.md"]
}
```

Docs are reusable reference material stored as markdown files anywhere under `<vault-root>`.

Skills are reusable workflows stored under `<vault-root>/skills/<skill-name>/SKILL.md`, optionally with adjacent `mcp.json`, examples, or assets. Runtime skill discovery loads valid skill folders from the configured skill roots; skill metadata is reference material, not a visibility toggle.

Projects are structured work packages with milestones, tasks, and durable status. See [Projects](../../docs/projects.md).

## Managed sync

Knowledge Base Sync uses git to synchronize vault content across machines. When configured, the runtime maintains a managed clone that serves as the effective vault root.

```text
Machine A ──► Git remote ◄── Machine B
                 │
          Managed clone
          <state-root>/knowledge-base/repo
                 │
            Effective vault root
```

Sync tracks local file snapshots, pulls remote changes, pushes local changes, and preserves recovery data when conflicts or errors occur. Sync state includes the configured repo URL, branch, last sync timestamp, last synced head, and file snapshot.

Sync status values:

| Status     | Meaning                      |
| ---------- | ---------------------------- |
| `disabled` | No repo URL configured       |
| `idle`     | Synced, waiting for changes  |
| `syncing`  | Currently pulling or pushing |
| `error`    | Last sync failed             |

When idle, status can also include local change count plus ahead/behind counts.

## System prompt and AGENTS.md

Knowledge affects agent behavior through file-based layers, not runtime prompt mutation. Pi assembles the final prompt from:

1. `SYSTEM.md` in the agent dir
2. `APPEND_SYSTEM.md` in the agent dir
3. discovered `AGENTS.md` / `CLAUDE.md` files from the CWD walk
4. available skills
5. current date and working directory

Extensions cannot modify the system prompt at runtime. To influence behavior, write durable content to the vault or one of the file-based instruction layers.

## Permissions

The extension declares `knowledge:read` and `knowledge:write` because it browses, edits, configures, and syncs local knowledge-base files.
