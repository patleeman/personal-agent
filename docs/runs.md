# Runs

Runs are detached agent work units. They execute shell commands or agent tasks in the background and can optionally deliver results back to a conversation.

## Run Types

| Type          | Description                                    |
| ------------- | ---------------------------------------------- |
| Shell command | Executes a bash command in the background      |
| Agent task    | Runs an agent with a prompt and optional model |

## Run Lifecycle

```
Created ──► Queued ──► Running ──► Completed
                              └──► Failed
                              └──► Cancelled
```

1. **Created** — the run is defined and submitted to the daemon
2. **Queued** — waiting for the daemon to pick it up
3. **Running** — the daemon is executing the work
4. **Completed** — finished successfully with output
5. **Failed** — finished with an error
6. **Cancelled** — stopped before completion

## Starting a Run

The agent starts runs using the `run` tool.

### Shell command

```json
{
  "action": "start",
  "taskSlug": "code-review",
  "command": "npm run lint && npm test",
  "cwd": "/path/to/project",
  "deliverResultToConversation": true
}
```

### Agent task

```json
{
  "action": "start_agent",
  "taskSlug": "review-pr",
  "prompt": "Review the changes in this PR and summarize",
  "model": "openai-codex/gpt-4o",
  "cwd": "/path/to/project"
}
```

## Run Tool Reference

| Action        | Parameters                                                                                | Description                             |
| ------------- | ----------------------------------------------------------------------------------------- | --------------------------------------- |
| `list`        | —                                                                                         | List all durable runs                   |
| `get`         | `runId`                                                                                   | Get run details                         |
| `logs`        | `runId`, `tail?`                                                                          | Get run output logs (max 1000 lines)    |
| `start`       | `taskSlug`, `command`, `cwd?`, `deliverResultToConversation?`                             | Start a shell command run               |
| `start_agent` | `taskSlug`, `prompt`, `model?`, `cwd?`, `defer?`, `cron?`, `deliverResultToConversation?` | Start an agent task run                 |
| `rerun`       | `runId`                                                                                   | Re-execute a completed run              |
| `follow_up`   | `runId`, `prompt`                                                                         | Send a follow-up prompt to an agent run |
| `cancel`      | `runId`                                                                                   | Cancel a running run                    |

### Start options for agent tasks

| Option                        | Format                   | Description                                                 |
| ----------------------------- | ------------------------ | ----------------------------------------------------------- |
| `defer`                       | `30s`, `10m`, `2h`, `1d` | Delay before starting                                       |
| `cron`                        | `"0 9 * * 1-5"`          | Cron expression for recurring execution                     |
| `deliverResultToConversation` | boolean                  | Whether completion should wake the originating conversation |

## Viewing Runs

Runs are listed in the Runs section of the desktop app. Each run entry shows:

- Status badge (running, completed, failed, cancelled)
- Task slug or command
- Start and end time
- Duration
- Output logs (inline, expandable)

## Logs

Run logs capture stdout and stderr from the executed command or agent. Access logs via the `run logs` action with an optional tail parameter:

```json
{
  "action": "logs",
  "runId": "abc123",
  "tail": 200
}
```

Maximum 1000 lines per request.

## Delivery

When `deliverResultToConversation` is true and the originating conversation still exists, the daemon wakes the conversation with the run results. This creates a callback entry visible in the conversation.

## Deferred and Recurring Runs

Agent tasks support:

- **Deferred start** — run after a delay (e.g., `30s`, `2h`)
- **Recurring schedule** — run on a cron expression (e.g., `"0 9 * * 1-5"`)

These use the daemon's scheduler and are distinct from the scheduled tasks feature. Use scheduled tasks when you need persistent automations with a UI. Use run `start_agent` with cron when you need a lightweight recurring agent from within a conversation.
