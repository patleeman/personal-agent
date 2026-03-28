# Runs

Runs are durable daemon-backed background jobs started on demand.

Use a run when you want detached work to start **now** and continue outside the current turn.

## When to use runs

Good fits:

- long-running shell commands you do not want to block on
- focused background agent jobs started now
- subagent work that should outlive the current turn
- local detached work you want to inspect later by run id

Do not use runs for:

- later or recurring work — use [Scheduled Tasks](./scheduled-tasks.md)
- lightweight ordered skill steps inside one conversation — use [Automation](./automation.md)
- direct human reminders — use reminders/alerts

## Two run modes

### Shell run

Start a detached shell command:

```bash
pa runs start code-review -- npm test
```

### Agent run

Start a detached background agent prompt:

```bash
pa runs start-agent code-review --prompt "review this diff"
```

This is the durable background-run form for focused subagent-style work.

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

## Related docs

- [Decision Guide](./decision-guide.md)
- [Automation](./automation.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Daemon and Background Automation](./daemon.md)
- [Command-Line Guide (`pa`)](./command-line.md)
