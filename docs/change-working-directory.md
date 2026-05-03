# Change Working Directory

The `change_working_directory` tool switches the conversation's working directory. After the change, all tool calls (file reads, shell commands, file writes) execute relative to the new directory.

## Parameters

| Parameter        | Type   | Required | Description                                                   |
| ---------------- | ------ | -------- | ------------------------------------------------------------- |
| `cwd`            | string | yes      | Target directory. Relative paths resolve from the current cwd |
| `continuePrompt` | string | no       | Prompt to execute automatically after the directory switch    |

## Behavior

1. The tool validates that the target directory exists
2. If valid, the conversation's cwd is updated
3. All subsequent tool calls use the new cwd as their working directory
4. If `continuePrompt` is provided, that prompt is queued as a follow-up

```json
// Change to a subdirectory
{ "cwd": "packages/core/src" }

// Change to an absolute path and continue working
{ "cwd": "/Users/me/other-project", "continuePrompt": "Review the README" }
```

## Scope

- The change affects only the calling conversation
- Other conversations retain their own working directories
- The change persists for the lifetime of the conversation
- If `continuePrompt` is provided, it runs in the new directory automatically

## Validation

| Condition                          | Result                        |
| ---------------------------------- | ----------------------------- |
| Target directory exists            | Cwd is updated                |
| Target directory does not exist    | Error returned, cwd unchanged |
| Target is a file (not a directory) | Error returned                |
| Relative path with no current cwd  | Error returned                |

## Use Cases

- **Deep navigation** — move from project root to `packages/core/src` for focused work
- **Multi-project sessions** — switch between projects without starting a new conversation
- **Build operations** — change to a subdirectory to run build commands
- **File operations** — navigate to the directory containing the files being edited

## Compared to @ references

|          | `change_working_directory`              | `@` file reference          |
| -------- | --------------------------------------- | --------------------------- |
| Scope    | All subsequent tool calls               | Single message              |
| Cwd      | Permanently changed                     | Unchanged                   |
| Use case | Working in a different part of the tree | Referencing a specific file |
