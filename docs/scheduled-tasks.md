# Scheduled Tasks

Scheduled tasks are persistent automations managed by the daemon. They run on a schedule (cron or one-time) and can execute as background agents or post to conversation threads.

## Task Definition

Each scheduled task has these fields:

| Field                  | Type                                     | Description                                                   |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| `title`                | string                                   | Human-readable name                                           |
| `cron`                 | string                                   | Cron expression for recurring schedule                        |
| `at`                   | string                                   | ISO timestamp or natural language for one-time                |
| `targetType`           | `"background-agent"` or `"conversation"` | Where the task executes                                       |
| `prompt`               | string                                   | Prompt to execute when the task fires                         |
| `model`                | string                                   | Optional model override                                       |
| `cwd`                  | string                                   | Working directory                                             |
| `timeoutSeconds`       | number                                   | Per-run timeout                                               |
| `catchUpWindowSeconds` | number                                   | Missed-run catch-up window; cron tasks default to 900 seconds |
| `threadMode`           | `"dedicated"`, `"existing"`, or `"none"` | Thread binding                                                |
| `threadConversationId` | string                                   | Existing conversation ID for thread binding                   |
| `enabled`              | boolean                                  | Whether the task is active                                    |

## Schedule Formats

### Cron expressions

Standard 5-field cron: `minute hour day month weekday`

```
"0 9 * * 1-5"    Every weekday at 9:00
"*/15 * * * *"   Every 15 minutes
"0 0 * * *"      Daily at midnight
```

### One-time

ISO timestamps or natural language:

```
"2026-06-01T09:00:00Z"
"tomorrow 8pm"
"now+1d@20:00"
```

## Thread Modes

| Mode        | Behavior                                                           |
| ----------- | ------------------------------------------------------------------ |
| `dedicated` | Creates a new conversation for each execution with a unique ID     |
| `existing`  | Posts to a specific existing conversation (`threadConversationId`) |
| `none`      | Runs without conversation interaction (background agent only)      |

## Catch-Up Window

If the daemon was offline when a scheduled time passed, the catch-up window controls whether the missed execution fires when the daemon restarts. Set in seconds. Cron automations default to 15 minutes (`900`) so a short app restart, laptop wake, or daemon restart does not silently skip the run. A 5-minute window (`300`) means: if the daemon was offline for less than 5 minutes past the scheduled time, the task runs on restart.

## Execution Flow

```
Scheduler tick ──► Check due tasks ──► For each due task:
                                           │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                        background-agent  conversation  conversation
                                          dedicated     existing
                              │            │            │
                              ▼            ▼            ▼
                         Run prompt    New thread    Post to thread
```

## Task Activity

Skipped and missed scheduler decisions are recorded as automation activity:

| Field              | Description                              |
| ------------------ | ---------------------------------------- |
| `createdAt`        | When the scheduler recorded the decision |
| `outcome`          | `skipped` or `catch-up-started`          |
| `count`            | Number of missed scheduled slots         |
| `firstScheduledAt` | First missed scheduled slot              |
| `lastScheduledAt`  | Latest missed scheduled slot             |

Activity is viewable in the Automations UI. Skipped cron slots outside the catch-up window and overlap skips also raise an active alert so missed automations are visible instead of silent. Normal executions still write durable run records and logs.

## Agent Tool Reference

The `scheduled_task` tool manages tasks from within a conversation:

| Action     | Description                 |
| ---------- | --------------------------- |
| `list`     | List tasks                  |
| `get`      | Get a task by ID            |
| `save`     | Create or update a task     |
| `delete`   | Delete a task               |
| `validate` | Validate task configuration |
| `run`      | Trigger immediate execution |

## Managing Tasks

Tasks are managed through the `scheduled_task` agent tool or the Automations UI. See [Automations](automations.md) for the desktop UI.
