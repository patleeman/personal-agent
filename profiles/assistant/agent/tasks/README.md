# Scheduled Tasks (Assistant Profile)

This directory contains daemon scheduled task definitions (`*.task.md`) for the assistant profile.

## Why this lives here

- Task files are kept **adjacent** to `../workspace/`.
- They are intentionally **not** stored inside `workspace/` to reduce accidental edits during project note maintenance.

## Rules

1. Keep task files as `<name>.task.md` with valid frontmatter.
2. Do not place task files under `../workspace/`.
3. Validate after edits: `pa tasks validate --all`.
4. Commit and push task-file changes so repo + scheduler stay in sync.
