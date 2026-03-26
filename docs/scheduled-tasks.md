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
- one-time reminders or check-ins
- unattended background prompts
- automation that should surface attention in the inbox

Do not confuse scheduled tasks with:

- **project tasks** in `state.yaml` — those are planning/checklist items
- **durable background runs** — those are detached jobs launched on demand with `pa runs start`

## Where task files live

Recommended location:

- `~/.local/state/personal-agent/sync/tasks/*.task.md`

Only files ending in `.task.md` are discovered automatically.

If daemon config does not override the task directory, discovery defaults to the shared durable task directory and filters by each task file's `profile` frontmatter.

## What a task file looks like

A scheduled task is Markdown with YAML frontmatter.

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

See the full example at [docs/examples/scheduled-task.task.md](./examples/scheduled-task.task.md).

## Required schedule fields

A task must define exactly one of:

- `cron` — recurring schedule
- `at` — one-time timestamp

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
- successful and failed runs create local inbox activity by default when the task file lives under profile resources

One-time tasks resolve once and do not run again.

## Run model

Tasks run as direct daemon-managed subprocesses.

Each run still writes a durable run record, log, and final result under the daemon state root.

## Managing tasks from the web UI

The Scheduled page lets you:

- inspect discovered tasks
- create a new task from the UI
- enable or disable a task
- edit a task from the detail rail with a form
- adjust common recurring schedules with an interactive schedule builder or fall back to raw cron
- run a task immediately
- inspect task status visually

See [Web UI Guide](./web-ui.md).

## Managing tasks from the CLI

### List tasks

```bash
pa tasks list
pa tasks list --status active
pa tasks list --json --status completed
```

### Show one task

```bash
pa tasks show <id>
pa tasks show <id> --json
```

### Validate task files

```bash
pa tasks validate
pa tasks validate --all
pa tasks validate /path/to/file.task.md
```

### Read logs

```bash
pa tasks logs <id>
pa tasks logs <id> --tail 120
```

## Logs and runtime state

Default daemon state root:

- `~/.local/state/personal-agent/daemon`

Useful files:

- task state: `task-state.json`
- run logs: `task-runs/<task-id>/...`

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

```bash
pa tasks validate --all
```

## Recommended workflow

1. create or update the `*.task.md` file
2. validate it with `pa tasks validate --all`
3. check daemon status with `pa daemon status`
4. inspect runs with `pa tasks show <id>` and `pa tasks logs <id>`
5. look for the resulting activity in the inbox if the task is meant to surface attention

## Related docs

- [Daemon and Background Automation](./daemon.md)
- [Inbox and Activity](./inbox.md)
- [Projects](./projects.md)
