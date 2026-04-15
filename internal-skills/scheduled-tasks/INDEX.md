---
id: scheduled-tasks
kind: internal-skill
title: Scheduled Tasks
summary: Built-in guidance for daemon-backed scheduled automations and conversation callbacks.
tools:
  - scheduled_task
---

# Scheduled Tasks

Scheduled tasks let `personal-agent` run prompts automatically through the daemon.

Use them when something should happen:

- later
- on a recurring schedule
- without an active conversation open

## When to use scheduled tasks

Good fits:

- morning reports
- recurring reviews
- unattended background prompts
- automation that should surface attention on its owning thread
- task-style work that may optionally callback into a conversation later

Do not confuse scheduled tasks with:

- **project tasks** in `state.yaml` — those are planning/checklist items
- **reminders** — those are conversation-bound wakeups with alert delivery
- **durable background runs** — those are detached jobs launched on demand with the `run` tool

## Where automations live

Canonical storage:

- `~/.local/state/personal-agent/daemon/runtime.db`

Automation definitions and scheduler runtime state now live in the daemon SQLite database.

Legacy `*.task.md` files under the daemon task directory are treated as import sources, not the primary record. If present, they are imported into SQLite and then the daemon/UI operate on the database copy.

## Legacy task-file import format

Legacy scheduled-task files are Markdown with YAML frontmatter.

```md
---
id: daily-status
enabled: true
cron: "0 9 * * 1-5"
profile: "assistant"
model: "openai-codex/gpt-5.4"
cwd: "~/agent-workspace"
timeoutSeconds: 1800
---
Summarize yesterday's work and top priorities for today.
```

The Markdown body is the prompt sent to Pi.

New automations created from the web UI are stored directly in SQLite instead of writing `*.task.md` files.

See the full example at [docs/examples/scheduled-task.task.md](../../docs/examples/scheduled-task.task.md).

## Required schedule fields

A task must define exactly one of:

- `cron` — recurring schedule
- `at` — one-time timestamp

## Web UI automation fields

The Automations page exposes the same core fields as Codex-style scheduled prompts:

- title
- prompt
- working directory (`cwd`)
- schedule (`cron` or one-time `at`)

Model and timeout still exist internally, but the default UI flow is intentionally narrow.

## Frontmatter reference

| Key | Required | Notes |
| --- | --- | --- |
| `id` | no | defaults from filename |
| `enabled` | no | defaults to `true` |
| `cron` | yes* | recurring 5-field cron |
| `at` | yes* | one-time timestamp parseable by `Date.parse` |
| `profile` | no | profile to run under |
| `provider` | no | optional if paired with `model` |
| `model` | no | full model ref, or combined with `provider` |
| `cwd` | no | working directory for the run |
| `timeoutSeconds` | no | per-run timeout |

\* Exactly one of `cron` or `at` is required.

## Cron vs one-time tasks

### Cron

Use cron when the task should run repeatedly.

Examples:

- every weekday morning
- every hour
- every Sunday evening

### `at`

Use `at` when the task should run once.

If the daemon is offline when the scheduled time passes, the run is marked skipped.

## Runtime behavior

Important behavior to understand:

- tasks are daemon-managed
- cron tasks run at most once per matching minute
- overlap is prevented; if one run is still active, the next due run is skipped
- retries happen up to the configured retry limit
- each run writes a log
- every automation defaults to a dedicated thread unless you explicitly bind it to an existing thread or disable thread ownership
- successful and failed runs stay on the automation and its owning thread by default
- tasks are still passive by default; they do not become interrupting reminders unless explicitly wired back to a conversation

One-time tasks resolve once and do not run again.

## Run model

Tasks run as direct daemon-managed subprocesses.

Each run still writes a durable run record, log, and final result under the daemon state root.

## Conversation callbacks

A scheduled task can optionally callback into the conversation that created it.

That callback path is intentionally separate from the durable `*.task.md` definition because conversation ids and session files are local runtime state.

When enabled, a task completion or failure can create:

- a conversation wakeup
- an alert
- the usual run/log trail on the owning thread

This is the right fit for:

- "run this later and tell me what happened"
- "watch for deployment gates and bring this thread back when it matters"

It is **not** the same as a generic reminder. For direct human reminders, prefer the reminder/conversation-wakeup path.

## Managing tasks from the web UI

The Automations page lets you:

- inspect discovered automations
- create a new automation from a centered modal launched from the page toolbar
- choose a dedicated thread, an existing thread, or no thread for each automation
- enable or disable an automation
- edit an automation from the detail view with a focused form
- delete an automation from the detail view with confirmation
- adjust common recurring schedules with an interactive schedule builder or fall back to raw cron
- run an automation immediately
- open the automation-owned thread directly from the detail view
- inspect automation status visually

See [Web UI Guide](../../docs/web-ui.md).

## Managing tasks with tools

Use the `scheduled_task` tool for create/update/get/validate/run flows.

Common actions:

- `save` — create or update a task definition
- `get` — inspect one task
- `validate` — validate a legacy task definition or proposed payload
- `run` — trigger a task immediately

Use the web UI when you want to inspect automation detail, status, and owned run history visually.

## Logs and runtime state

Default daemon state root:

- `~/.local/state/personal-agent/daemon`

Useful storage:

- automation definitions + scheduler state: `runtime.db`
- durable run logs/results: `runs/<run-id>/{output.log,result.json}`

Useful status command:

```bash
pa daemon status
```

## Common validation failures

Typical problems:

- malformed or missing frontmatter
- both `cron` and `at` set
- neither `cron` nor `at` set
- empty Markdown body

Quick check:

Use the `scheduled_task` tool with `action: "validate"`.

## Recommended workflow

1. create or edit automations in the web UI when possible
2. use the `scheduled_task` tool to inspect, validate, or trigger automations programmatically
3. if you still manage legacy `*.task.md` files, validate them before expecting them to import cleanly
4. check daemon status with `pa daemon status`
5. look for the resulting run/status on the automation and its owning thread if the automation is meant to surface attention

## Related docs

- [Decision Guide](../../docs/decision-guide.md)
- [Async Attention and Wakeups](../async-attention/INDEX.md)
- [Daemon and Background Automation](../../docs/daemon.md)
- [Shared Inbox Removal](../inbox/INDEX.md)
- [Tracked Pages](../../docs/projects.md)
- [Runs](../runs/INDEX.md)
