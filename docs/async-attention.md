# Async Attention and Wakeups

This page explains how `personal-agent` surfaces work that matters later.

The core distinction is:

- **passive attention** → inbox/activity
- **interrupting attention** → alerts/reminders
- **conversation continuation** → wakeups such as deferred resume

## The three layers

### 1. Durable record

Every async event should have a durable home.

That durable home is usually one of:

- a conversation
- an activity item
- a project update
- a run record or log
- a task run log
- an artifact

The durable record is the source of truth.

### 2. Attention surface

The attention surface answers:

> what should I notice now or later?

That is where inbox/activity and alerts live.

### 3. Wakeup behavior

A wakeup answers:

> should a conversation continue later, and with what prompt?

Deferred resumes, reminders, and some scheduled-task callbacks use this layer.

## Choose the right async surface

| Need | Use | Attention style | Durable home |
| --- | --- | --- | --- |
| Passive async summary with no conversation | activity / inbox | passive | standalone activity item |
| Async result tied to an inactive conversation | surface the conversation | passive by default | conversation + linked activity/logs |
| Human reminder that should interrupt | reminder / alert | interrupting | wakeup + alert + activity/state |
| Agent should continue this conversation later | deferred resume | usually passive unless paired with alerting | wakeup + conversation |
| Scheduled automation completes later | task activity, optionally callback into a conversation | passive by default | task log + activity + optional conversation wakeup |
| High-signal blocked or failed background work | alert, often with activity too | interrupting | conversation or activity plus logs |

## Inbox / activity

Use activity when something happened and it is worth noticing later, but does not need to interrupt.

Good fits:

- scheduled task output
- background failures worth reviewing later
- daemon/system events worth surfacing
- async work that finished outside the foreground thread

If the event belongs to a known conversation, keep the durable result with that conversation and surface the conversation in the inbox instead of creating a duplicate visible row by default.

See [Inbox and Activity](./inbox.md).

## Alerts and reminders

Use alerts when the event should interrupt.

Good fits:

- user-requested reminders
- approval-needed callbacks
- blocked or failed background work that needs immediate attention
- scheduled-task callbacks that should be hard to miss

Alerts are intentionally sparse. They sit on top of the durable record and attention model; they are not the durable record themselves.

See [Alerts and Reminders](./alerts.md).

## Deferred resume

Use deferred resume when the agent should come back to the same conversation later.

This is the right fit for:

- continue checking later
- try again after waiting
- resume a thread when time has passed
- stage unattended multi-step work that should return here later

Use deferred resume when the user does **not** need a direct reminder. If the user explicitly wants "tell me later," use a reminder instead.

A self-distill wakeup is just a conservative deferred resume aimed back at the same conversation.
Use it when the agent thinks a thread may deserve a later durable review, but wants a high-bar follow-up instead of passive transcript mining.
The first-pass outcomes should stay narrow: no-op, note update, or linked project update.

## Scheduled-task callbacks

Scheduled tasks stay passive by default.

They:

- run through the daemon
- write logs and durable run state
- create activity

When explicitly bound back to a conversation, they can also create:

- a conversation wakeup
- an alert
- linked activity

That is the right fit for things like:

- run this later and tell me what happened
- keep watching and bring this thread back when it matters

## Practical routing rules

Use these defaults:

- **foreground work** stays in the conversation
- **standalone async work** becomes activity
- **async work tied to a dormant conversation** surfaces the conversation
- **user-requested tell-me-later behavior** becomes a reminder/alert
- **agent-initiated continue-later behavior** becomes deferred resume
- **agent-initiated later durable review of one conversation** becomes a self-distill wakeup, not background transcript mining

## What not to do

Do not:

- turn every reply into inbox activity
- use alerts for ordinary passive async summaries
- store the durable record only in the alert layer
- use reminders when a scheduled task or deferred resume is the real need
- copy conversation ids into portable durable files

## Related docs

- [Decision Guide](./decision-guide.md)
- [Inbox and Activity](./inbox.md)
- [Alerts and Reminders](./alerts.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Conversations](./conversations.md)
