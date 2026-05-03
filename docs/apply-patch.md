# Apply Patch

The `apply_patch` tool applies structured file patches to the workspace. It handles file creation, deletion, updating, and moving through a declarative patch format with conflict detection.

> **Model support:** `apply_patch` is only available for GPT-series models (any model whose ID starts with `gpt-`). Other models fall back to the standard `edit` and `write` tools.

## Supported Operations

| Operation   | Marker                    | Description                                          |
| ----------- | ------------------------- | ---------------------------------------------------- |
| Add file    | `*** Add File: <path>`    | Creates a new file with specified contents           |
| Update file | `*** Update File: <path>` | Modifies an existing file with targeted replacements |
| Delete file | `*** Delete File: <path>` | Removes a file                                       |
| Move file   | `*** Move to: <path>`     | Moves/renames a file                                 |

## Patch Format

Patches use markers to delimit operations within a single tool call:

```
*** Begin Patch

*** Add File: new-file.ts
console.log('hello');
*** End of File

*** Update File: existing-file.ts
@@ ... @@
-old code
+new code
@@ ... @@
-Line to delete
+Line to add instead
*** End of File

*** Delete File: old-file.ts

*** End Patch
```

### Update file format

Update operations use unified-diff-style hunks:

```
@@ <context> @@
-old text
+new text
```

Each hunk specifies the exact text to replace. Multiple hunks can update different parts of the same file.

## Execution

The tool processes operations through a file mutation queue:

1. All operations are validated before any are applied
2. Files are checked for existence (add operations require the file to not exist; update/delete operations require it to exist)
3. Operations are executed in order
4. Conflicts are detected when multiple hunks target overlapping regions

## Error Handling

| Condition                     | Behavior                                |
| ----------------------------- | --------------------------------------- |
| File to update does not exist | Error returned, no changes applied      |
| File to add already exists    | Error returned, no changes applied      |
| Patch hunk does not match     | Error with context showing the mismatch |
| Conflicting changes detected  | Error before any mutation               |

## Use Cases

- **Precise edits** — change specific lines without rewriting the entire file
- **Multi-file refactoring** — add, update, and delete files in a single tool call
- **Safe automated edits** — validation runs before any write operation executes
- **Code generation** — create new files with proper structure
