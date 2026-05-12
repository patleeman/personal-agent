# Background Work Extension

This extension owns the UI and compatibility tool for detached background work.

Background work has two user-facing shapes:

| Type               | Description                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Background command | A daemon-backed shell command with logs, status, cancel, and rerun behavior.                            |
| Subagent           | A daemon-backed agent delegation with prompt, model, transcript/result, follow-up, and cancel behavior. |

The generic `run` name is legacy compatibility plumbing. Product UI should say **Background commands** or **Subagents**, and agent-facing surfaces should prefer intent-shaped tools over a generic run abstraction.

## Lifecycle

```text
Created -> Queued -> Running -> Completed
                         |-> Failed
                         |-> Cancelled
```

## Tool guidance

- Prefer `bash` with background execution for background commands when that tool surface is available.
- Prefer a dedicated `subagent` tool for delegated agent work when that tool surface is available.
- Keep `scheduled_task` separate for persistent automations.
- Use this extension's legacy `run` tool only for compatibility and low-level inspection (`list`, `get`, `logs`, `rerun`, `follow_up`, `cancel`).

## UI

The conversation rail is titled **Background work** and groups records into **Background commands** and **Subagents**. The backend may still store both as durable run records; that storage detail should not leak into product copy.
