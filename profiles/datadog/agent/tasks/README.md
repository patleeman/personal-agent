# Scheduled Tasks (Datadog Profile)

This directory contains daemon scheduled task definitions (`*.task.md`) for the datadog profile.

## Rules

1. Keep task files as `<name>.task.md` with valid frontmatter.
2. Keep tasks adjacent to `../workspace/` (not inside workspace).
3. Validate after edits: `pa tasks validate --all`.
4. Commit and push task-file changes so repo + scheduler stay in sync.
