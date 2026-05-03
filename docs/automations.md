# Automations

Automations is the desktop UI for managing scheduled background tasks. Navigate to `/automations` to view, create, edit, and manage automations.

## List View

The automations list shows all configured automations in a table:

| Column   | Description                             |
| -------- | --------------------------------------- |
| Title    | Automation name                         |
| Schedule | Cron expression or one-time time        |
| Target   | Background agent or conversation        |
| Status   | Enabled/disabled indicator              |
| Last run | Timestamp and outcome of last execution |

Sort and filter the list by any column.

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

From the activity history, click a run ID to view the run details and logs. See [Runs](runs.md) for run reference.

## Relationship to the Daemon

Automations are stored in the daemon's automation store (SQLite database at `<state-root>/daemon/`). The daemon scheduler checks for due automations and executes them. The UI communicates with the daemon through the tasks API.
