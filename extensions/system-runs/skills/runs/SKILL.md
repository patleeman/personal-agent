---
name: background-work
description: Use when starting, inspecting, rerunning, following up, or cancelling durable background commands or subagents.
metadata:
  id: runs
  title: Background Work
  summary: Built-in guidance for detached background commands, subagents, inspection, and follow-up behavior.
  status: active
tools:
  - background_command
  - subagent
  - run
---

# Background Work

Use intent-shaped tools first. The old generic `run` tool is compatibility plumbing, not the mental model.

## Choose the tool

| Tool                              | Use case                                                                 |
| --------------------------------- | ------------------------------------------------------------------------ |
| `background_command`              | A shell command that should run durably outside the current turn.        |
| `subagent`                        | A delegated agent task that should run durably outside the current turn. |
| `scheduled_task`                  | A persistent automation with a cron/time trigger and delivery policy.    |
| `conversation_queue` / `reminder` | Attention or follow-up without background execution.                     |

## Background commands

Start a detached command:

```json
{
  "action": "start",
  "taskSlug": "tests",
  "command": "npm test",
  "cwd": "/path/to/repo"
}
```

Use `get`, `logs`, `rerun`, and `cancel` for lifecycle management.

## Subagents

Start delegated agent work:

```json
{
  "action": "start",
  "taskSlug": "review-diff",
  "prompt": "Review the current diff and summarize the risks.",
  "cwd": "/path/to/repo"
}
```

Use `follow_up` to continue a stopped subagent and `get`, `logs`, `rerun`, and `cancel` for lifecycle management.

## Compatibility

`run` still exists for older prompts and low-level inspection. If you use it:

- `action=start` means background command.
- `action=start_agent` means subagent.
- scheduling flags on `start_agent` create saved automations; prefer `scheduled_task` for new persistent automation work.

The product UI should say **Background commands** and **Subagents**. Treat “run” as the durable storage record only.
