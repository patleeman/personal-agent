# Automations Extension

This extension owns the product behavior documented below. Keep extension-specific user and agent docs here so the implementation and documentation move together.

---

<!-- Source: docs/automations.md -->

# Automations

Automations is the desktop UI for managing scheduled background tasks. Navigate to `/automations` to view, create, edit, and manage automations. Scheduled tasks are managed in this page and attention surfaces, not in every conversation composer.

## List View

The automations list uses the same table-first layout pattern as the Extensions page: filter chips, search, compact row actions, a dense multi-column table, and a compact scheduler-health dot instead of a full-width banner.

Enabled one-time automations whose scheduled time has already passed without a recorded run move into a **Past due** section so they stay visible without looking like upcoming work.

Each row shows:

- automation name, prompt summary, and scope
- schedule summary plus raw cron or timestamp
- current status and last-run state
- compact icon actions for run, edit, open thread, and more actions
- delete from the row actions menu or the editor view

## Detail View

Click an automation to open its detail page. Shows:

**Configuration:**

- Title and ID
- Schedule (cron or one-time)
- Target type and thread binding
- Prompt to execute
- Model override (if any)
- Working directory
- Timeout setting

**Activity history:**

A chronological log of every execution:

| Column  | Description                       |
| ------- | --------------------------------- |
| Time    | When it ran                       |
| Outcome | Success, failure, or timeout      |
| Error   | Error message (if failed)         |
| Run ID  | Associated run for log inspection |

**Actions:**

- Run now — trigger immediate execution
- Enable/disable — toggle without deleting
- Edit — modify configuration
- Delete — remove the automation

## Creating an Automation

From the list view, click "New Automation". The editor uses the Settings page layout with a right-side "On this page" rail and four sections:

- **General** — automation name, recurring instruction, and enabled state
- **Schedule** — recurring vs one-time scheduling, common cron presets, raw cron, and a human-readable preview
- **Delivery** — background/conversation target plus thread binding summary
- **Runtime** — optional working directory, model, timeout, and catch-up window

Raw daemon fields are still available, but common schedules can be selected from presets instead of starting with cron syntax.

## Inspecting Runs

From the activity history, click a run ID to view the run details and logs. See [Runs](../system-runs/README.md) for run reference.

## Relationship to the Daemon

Automations are stored in the daemon's automation store (SQLite database at `<state-root>/daemon/`). The daemon scheduler checks for due automations and executes them. The UI communicates with the daemon through the tasks API.

---

<!-- Source: docs/scheduled-tasks.md -->

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

The Automations page also shows scheduler health from the daemon scheduler state. If the scheduler has not checked schedules within the stale window, the UI surfaces a warning and raises an active alert. Automation detail pages show the latest expected scheduled slot next to the actual recorded result, so a missing run is visible without spelunking through logs. Failures that happen before a durable run can be created are recorded as automation activity and alerted separately.

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

Tasks are managed through the `scheduled_task` agent tool or the Automations UI. See [Automations](README.md) for the desktop UI.

---

<!-- Source: docs/followups.md -->

# Follow-up Queue

Follow-up queue entries resume the current conversation later. They are conversation-bound and are the only user-facing tool for same-thread delayed continuation.

Use the `queue_followup` tool from within a conversation.

## Actions

| Action   | Description                                    |
| -------- | ---------------------------------------------- |
| `add`    | Queue a follow-up after this turn or at a time |
| `list`   | List queued follow-ups for this conversation   |
| `cancel` | Cancel a queued follow-up by listed `id`       |

## Add by delay

```json
{
  "action": "add",
  "trigger": "delay",
  "delay": "30s",
  "prompt": "Check if the build finished",
  "title": "Build check"
}
```

## Add by absolute time

```json
{
  "action": "add",
  "trigger": "at",
  "at": "tomorrow 8pm",
  "prompt": "Check whether the release is ready",
  "title": "Release check"
}
```

## Add after current turn

```json
{
  "action": "add",
  "trigger": "after_turn",
  "prompt": "Continue with the next step"
}
```

Supported time formats match scheduled tasks: ISO timestamps, natural language, and explicit forms like `now+1d@20:00`.

## Relationship to scheduled tasks

|             | Follow-up queue          | Scheduled tasks                  |
| ----------- | ------------------------ | -------------------------------- |
| Scope       | Current conversation     | App-wide                         |
| Trigger     | After-turn, delay, time  | Cron or one-time                 |
| Target      | Always this conversation | Background agent or conversation |
| Persistence | Deferred resume state    | Automation store                 |

Use `queue_followup` when this conversation should continue later. Use `scheduled_task` when unattended work should run on a schedule.
