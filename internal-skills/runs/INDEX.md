---
id: runs
kind: internal-skill
title: Runs
summary: Built-in guidance for detached durable background runs, inspection, and follow-up behavior.
tools:
  - run
---

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
- task-file-based automation — use [Scheduled Tasks](../scheduled-tasks/INDEX.md)
- direct human reminders — use reminders/alerts
- pure "continue this conversation later" wakeups with no background job — use `conversation_queue`

## Shell run

Start a detached shell command with the `run` tool:

```json
{
  "action": "start",
  "taskSlug": "code-review",
  "command": "npm test"
}
```

## Agent run (with scheduling)

Start a detached background agent prompt:

```json
{
  "action": "start_agent",
  "taskSlug": "code-review",
  "prompt": "review this diff"
}
```

Add scheduling with `defer`, `cron`, or `at`:

```json
{
  "action": "start_agent",
  "taskSlug": "check-status",
  "prompt": "check deployment",
  "defer": "1h"
}
```

```json
{
  "action": "start_agent",
  "taskSlug": "morning-report",
  "prompt": "summarize",
  "cron": "0 9 * * 1-5"
}
```

```json
{
  "action": "start_agent",
  "taskSlug": "deploy-watch",
  "prompt": "verify",
  "at": "2026-04-01T09:00"
}
```

For looping agents (self-scheduling):

```json
{
  "action": "start_agent",
  "taskSlug": "monitor",
  "prompt": "check X",
  "loop": true,
  "loopDelay": "1h",
  "loopMaxIterations": 10
}
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

## Core actions

Use the `run` tool with these actions:

- `start`
- `start_agent`
- `get`
- `logs`
- `rerun`
- `follow_up`
- `cancel`

## Mental model

A run is:

- detached
- durable enough to inspect later
- daemon-owned
- started explicitly, not on a schedule

If you want "start now and track it later," use a run.

If you want "run this tomorrow" or "run this every hour," use a scheduled task instead.

## Durable state

Runs live under the daemon state root.

The source of truth is:

- `~/.local/state/personal-agent/daemon/runtime.db`

Per-run filesystem data still exists for blob-like outputs such as:

- `~/.local/state/personal-agent/daemon/runs/<run-id>/output.log`
- `~/.local/state/personal-agent/daemon/runs/<run-id>/result.json`

That keeps run metadata in SQLite while preserving inspectable logs and results on disk.

## Task slug and source

Each run uses a short task slug such as `code-review` or `subagent`.

The slug is how you group and recognize the work. It is not a schedule and it does not by itself make the run recurring.

## Relationship to conversations

A run can be launched from the context of a conversation, but the run itself is a detached background record.

Stopped runs are not one-shot anymore:

- use **rerun** to replay the same detached work from scratch
- use **follow-up** to continue a stopped background agent run with a new prompt while carrying its prior transcript forward

When a run is launched from a web conversation, completion only wakes that originating conversation back up when you opt in with `deliverResultToConversation=true`.

In the web UI, runs that belong to a conversation can open that conversation directly with the run inspector selected. Agent runs that created their own transcript prefer that transcript conversation.

Use runs when you want to avoid blocking the current thread. Then inspect the run later with its run id.

If the outcome should eventually drive user attention, pair that behavior with the appropriate surface:

- the owning conversation/thread for passive async follow-up
- reminder / notification delivery for interrupting follow-up
- conversation wakeup if the result should resume a specific thread

## Choosing the right tool

| Tool | Use case | Example |
|------|----------|----------|
| `run` | Ad-hoc prompts, now/defer/cron/loop | "check deployment in 1h" |
| `conversation_queue` | Continue same conversation later | "resume this thread in 30m" |
| `scheduled_task` | Persistent task definitions | "morning report every weekday" |
| `reminder` | Direct human reminders | "remind me tomorrow" |

For "run this prompt later," use `run` with `--defer`.
For "run this every hour," use `run` with `--cron`.
For "run this and have it loop," use `run` with `--loop`.
For "continue this conversation later" with no detached job, use `conversation_queue`.
For "persistent automation from a file," use `scheduled_task`.

## Related docs

- [Decision Guide](../../docs/decision-guide.md)
- [Scheduled Tasks](../scheduled-tasks/INDEX.md)
- [Daemon and Background Automation](../../docs/daemon.md)
- [Command-Line Guide (`pa`)](../../docs/command-line.md)
