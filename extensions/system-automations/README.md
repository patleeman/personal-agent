# Automations Extension

This extension owns the product behavior documented below. Keep extension-specific user and agent docs here so the implementation and documentation move together.

---

<!-- Source: docs/automations.md -->

# Automations

Automations is the desktop UI for managing scheduled background tasks. Navigate to `/automations` to view, create, edit, and manage automations. Scheduled tasks are managed in this page and attention surfaces, not in every conversation composer.

## List View

The automations list groups active schedules under **Current**. Enabled one-time automations whose scheduled time has already passed without a recorded run move into a **Past due** section so they stay visible without looking like upcoming work.

Each row shows:

- automation name and scope
- schedule
- delivery target
- current status and last-run state
- row actions for run, edit, and log access

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

From the list view, click "New Automation" and fill in:

### Schedule

- **Cron** — standard 5-field cron expression
- **One-time** — ISO timestamp or natural language

### Target

| Target           | Behavior                                  |
| ---------------- | ----------------------------------------- |
| Background agent | Runs in the daemon without a conversation |
| Conversation     | Posts result to a conversation thread     |

### Thread binding

| Mode      | When to use                              |
| --------- | ---------------------------------------- |
| Dedicated | Each execution gets a fresh conversation |
| Existing  | Posts to an existing conversation        |
| None      | No thread (background agent only)        |

### Prompt

The prompt to execute when the automation fires. Supports the same content as a normal conversation prompt.

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

<!-- Source: docs/reminders.md -->

# Reminders

Reminders are tell-me-later wakeups that resume a conversation at a specified time. They are conversation-bound — each reminder is tied to the thread where it was created.

## Creating a Reminder

Use the `reminder` tool from within a conversation. Specify either a relative delay or an absolute time.

### By delay

```json
{
  "delay": "30s",
  "prompt": "Check if the build finished",
  "title": "Build check"
}
```

Supported delay units: `s` (seconds), `m` (minutes), `h` (hours), `d` (days).

### By absolute time

```json
{
  "at": "tomorrow 8pm",
  "prompt": "Remind me to deploy the release",
  "title": "Release deploy"
}
```

Supports ISO timestamps (`2026-06-01T09:00:00Z`), natural language (`tomorrow 8pm`, `next monday 9am`), and explicit forms (`now+1d@20:00`).

## Parameters

| Parameter          | Required    | Description                                          |
| ------------------ | ----------- | ---------------------------------------------------- |
| `delay`            | conditional | Relative time until the reminder fires               |
| `at`               | conditional | Absolute time for the reminder to fire               |
| `prompt`           | yes         | What the agent should do when the reminder fires     |
| `title`            | no          | Short label shown in alerts                          |
| `notify`           | no          | Alert style: `"disruptive"` (default) or `"passive"` |
| `requireAck`       | no          | Whether the alert stays until acknowledged           |
| `autoResumeIfOpen` | no          | Auto-resume the conversation if already open         |

Exactly one of `delay` or `at` must be specified.

## Delivery

When a reminder fires:

1. The daemon wakes the conversation
2. The prompt is delivered to the agent as a user message
3. The agent processes the prompt and responds
4. An in-app alert is raised in the desktop app

## Alert Behavior

| `notify` value | Behavior                                                        |
| -------------- | --------------------------------------------------------------- |
| `"disruptive"` | Default. Raises an in-app notification that interrupts the user |
| `"passive"`    | Quiet notification that does not interrupt                      |

| `requireAck`      | Behavior                                                    |
| ----------------- | ----------------------------------------------------------- |
| `true`            | Alert stays active in the UI until the user acknowledges it |
| `false` (default) | Alert fires once and is dismissed                           |

| `autoResumeIfOpen` | Behavior                                                             |
| ------------------ | -------------------------------------------------------------------- |
| `true`             | If the target conversation is already open, it resumes automatically |
| `false` (default)  | The conversation is resumed in the background                        |

## Reminders vs Scheduled Tasks

|             | Reminders              | Scheduled Tasks                  |
| ----------- | ---------------------- | -------------------------------- |
| Scope       | Conversation-bound     | App-wide                         |
| Trigger     | Delay or absolute time | Cron or one-time                 |
| Target      | Always a conversation  | Background agent or conversation |
| Alert       | In-app notification    | Optional callback                |
| Persistence | Runtime state          | Automation store                 |

Use reminders when you want the agent to tell you something later. Use scheduled tasks when you want unattended work to happen on a schedule.

## Storage

Reminders are stored in the daemon's runtime database and survive daemon restarts. When a reminder fires while the daemon is offline, it fires on the next daemon startup.
