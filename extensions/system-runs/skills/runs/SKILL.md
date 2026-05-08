---
name: runs
description: Use when starting, inspecting, rerunning, following up, or cancelling durable daemon-backed background runs.
metadata:
  id: runs
  title: Runs
  summary: Built-in guidance for detached durable background runs, inspection, and follow-up behavior.
  status: active
tools:
  - run
---

# Runs

Runs are durable daemon-backed background jobs started on demand.

User-facing UI should avoid using "run" as the primary label. Treat **run** as the internal durable record. In the product, prefer:

- **Shell command** for detached terminal commands started with `action=start`.
- **Agent task** for detached/subagent prompts started with `action=start_agent`.
- **Automation execution** for work created by a scheduled task.
- **Wakeup** for conversation resume machinery.
- **Conversation session** for the live foreground chat process.

Use a run when you want detached work to start **now** or **loop** immediately.

## When to use runs

Good fits:

- long-running shell commands you do not want to block on
- focused background agent jobs that should start now
- subagent work that should outlive the current turn
- local detached work you want to inspect later by run id
- looping agents that schedule their own next iteration

Do not use runs for:

- task-file-based automation — use [Scheduled Tasks](../../../system-automations/skills/scheduled-tasks/SKILL.md)
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

## Agent run

Start a detached background agent prompt immediately:

```json
{
  "action": "start_agent",
  "taskSlug": "code-review",
  "prompt": "review this diff"
}
```

Add scheduling with `defer`, `cron`, or `at` when you want a saved automation instead of an immediate run:

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

| Flag                    | Example              | Description              |
| ----------------------- | -------------------- | ------------------------ |
| `--defer`               | `1h`, `30m`, `2h30m` | Delay before running     |
| `--cron`                | `"0 9 * * 1-5"`      | Recurring schedule       |
| `--at`                  | `"2026-04-01T09:00"` | One-time timestamp       |
| `--loop`                |                      | Enable looping mode      |
| `--loop-delay`          | `1h`                 | Delay between iterations |
| `--loop-max-iterations` | `10`                 | Stop after N iterations  |

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
- started explicitly now

If you want "start now and track it later," use a run.

If you want "run this tomorrow" or "run this every hour," use a scheduled task / automation instead.

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

| Tool                 | Use case                                      | Example                        |
| -------------------- | --------------------------------------------- | ------------------------------ |
| `run`                | Ad-hoc prompts that start now, plus loop mode | "start a code review now"      |
| `conversation_queue` | Continue same conversation later              | "resume this thread in 30m"    |
| `scheduled_task`     | Persistent task definitions / automations     | "morning report every weekday" |
| `reminder`           | Direct human reminders                        | "remind me tomorrow"           |

For "run this prompt later," use `run` with `--defer` to create a saved automation.
For "run this every hour," use `run` with `--cron` to create a saved automation.
For "run this and have it loop," use `run` with `--loop`.
For "continue this conversation later" with no detached job, use `conversation_queue`.
For "persistent automation from a file," use `scheduled_task`.

## Related docs

- [Decision Guide](../../../../docs/decision-guide.md)
- [Scheduled Tasks](../../../system-automations/skills/scheduled-tasks/SKILL.md)
- [Daemon and Background Automation](../../../../docs/daemon.md)
- [Command-Line Guide (`pa`)](../../../../docs/command-line.md)
