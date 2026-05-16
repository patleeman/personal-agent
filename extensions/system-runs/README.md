# Background Work Extension

This extension owns the UI and compatibility tool for detached background work.

Product-facing UI is moving to the **Execution** model. A durable run is the daemon/runtime storage record; an execution is the app-level projection used by routes, extension APIs, and conversation-scoped UI. Do not add new product UI that filters raw `/api/runs` records directly.

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

- Use `bash` for shell commands. Set `background: true` when the command should run durably outside the current turn.
- Prefer the dedicated `subagent` tool for delegated agent work, including `get`, `logs`, `rerun`, `follow_up`, and `cancel` on subagent IDs.
- `subagent.allowedTools` accepts agent tool names, not shell commands. Use names like `bash`, `read`, `edit`, `web_fetch`, `conversation_inspect`, or `checkpoint`; for `rg`, `grep`, `find`, or `ls`, allow `bash` and run the command inside bash.
- Keep `scheduled_task` separate for persistent automations.
- `background_command` is shell-only; it lists/inspects background commands and rejects subagent IDs with a hint to use `subagent`.
- Use `deferred_resume` for “wait, then continue this conversation” requests. Do not use foreground `bash` with `sleep` as a timer.
- Use this extension's legacy `run` tool only for compatibility and low-level inspection (`list`, `get`, `logs`, `rerun`, `follow_up`, `cancel`).

## UI

The conversation rail is titled **Background work** and groups execution records into **Background commands** and **Subagents**. It should consume the conversation-scoped executions API (`/api/conversations/:id/executions`) instead of loading the global durable run list and inferring relationships in the renderer. The backend may still store executions as durable run records; that storage detail should not leak into product copy.
