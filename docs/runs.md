# Runs

Runs are durable daemon-backed background jobs started on demand.

Use a run when you want detached work to start **now**, **later**, **recurring**, or **looping**.

## When to use runs

Good fits:

- long-running shell commands you do not want to block on
- focused background agent jobs (now, later, or recurring)
- subagent work that should outlive the current turn
- local detached work you want to inspect later by run id
- looping agents that schedule their own next iteration

Do not use runs for:
- task-file-based automation — use [Scheduled Tasks](./scheduled-tasks.md)
- direct human reminders — use reminders/alerts
- conversation-bound wakeups — use `deferred_resume`

## Shell run

Start a detached shell command:

```bash
pa runs start code-review -- npm test
```

## Agent run (with scheduling)

Start a detached background agent prompt:

```bash
pa runs start-agent code-review --prompt "review this diff"
```

Add scheduling with `--defer`, `--cron`, or `--at`:

```bash
# Run in 1 hour
pa runs start-agent check-status --prompt "check deployment" --defer 1h

# Run weekdays at 9am
pa runs start-agent morning-report --prompt "summarize" --cron "0 9 * * 1-5"

# Run at specific time
pa runs start-agent deploy-watch --prompt "verify" --at "2026-04-01T09:00"
```

For looping agents (self-scheduling):

```bash
pa runs start-agent monitor --prompt "check X" --loop --loop-delay 1h --loop-max-iterations 10
```

## Trigger options for agent runs

| Flag | Example | Description |
|------|---------|-------------|
| `--defer` | `1h`, `30m`, `2h30m` | Delay before running |
| `--cron` | `"0 9 * * 1-5"` | Recurring schedule |
| `--at` | `"2026-04-01T09:00"` | One-time timestamp |
| `--loop` | | Enable looping mode |
| `--loop-delay` | `1h` | Delay between iterations |
| `--loop-max-iterations` | `10` | Stop after N iterations |

## Core commands

```bash
pa runs list
pa runs show <id>
pa runs logs <id> --tail 120
pa runs start <task-slug> -- <command...>
pa runs start-agent <task-slug> --prompt "..."
pa runs cancel <id>
```

## Mental model

A run is:

- detached
- durable enough to inspect later
- daemon-owned
- started explicitly, not on a schedule

If you want "start now and track it later," use a run.

If you want "run this tomorrow" or "run this every hour," use a scheduled task instead.

## Durable state

Runs live under the daemon state root:

- `~/.local/state/personal-agent/daemon/runs/<run-id>/`

A run record contains files such as:

- `manifest.json`
- `status.json`
- `checkpoint.json`
- `events.jsonl`
- `output.log`
- `result.json`

That makes runs inspectable and recoverable as daemon-owned background work.

## Task slug and source

Each run uses a short task slug such as `code-review` or `subagent`.

The slug is how you group and recognize the work. It is not a schedule and it does not by itself make the run recurring.

## Relationship to conversations

A run can be launched from the context of a conversation, but the run itself is a detached background record.

Use runs when you want to avoid blocking the current thread. Then inspect the run later with its run id.

If the outcome should eventually drive user attention, pair that behavior with the appropriate surface:

- activity / inbox for passive async follow-up
- reminder / alert for interrupting follow-up
- conversation wakeup if the result should resume a specific thread

## Choosing the right tool

| Tool | Use case | Example |
|------|----------|----------|
| `run` | Ad-hoc prompts, now/defer/cron/loop | "check deployment in 1h" |
| `deferred_resume` | Continue same conversation later | "resume this thread in 30m" |
| `scheduled_task` | Persistent task definitions | "morning report every weekday" |
| `reminder` | Direct human reminders | "remind me tomorrow" |

For "run this prompt later," use `run` with `--defer`.
For "run this every hour," use `run` with `--cron`.
For "run this and have it loop," use `run` with `--loop`.
For "continue this conversation later," use `deferred_resume`.
For "persistent automation from a file," use `scheduled_task`.

## Related docs

- [Decision Guide](./decision-guide.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Daemon and Background Automation](./daemon.md)
- [Command-Line Guide (`pa`)](./command-line.md)
