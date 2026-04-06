# Async Attention and Wakeups

This page explains how `personal-agent` surfaces work that matters later.

The core distinction is:

- **in-app attention** → inbox/activity plus reminder/callback notifications shown inline there
- **stronger delivery** → browser/companion notifications and reminder-specific actions such as snooze
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

That is where inbox/activity live, including reminder and callback notifications rendered inline in the inbox.

### 3. Wakeup behavior

A wakeup answers:

> should a conversation continue later, and with what prompt?

Deferred resumes, reminders, and some scheduled-task callbacks use this layer.

## Choose the right async surface

| Need | Use | Attention style | Durable home |
| --- | --- | --- | --- |
| Passive async summary with no conversation | activity / inbox | passive | standalone activity item |
| Async result tied to an inactive conversation | surface the conversation | passive by default | conversation + linked activity/logs |
| Human reminder that should interrupt | reminder | inbox notification + optional browser/companion delivery | wakeup + notification state + activity/state |
| Agent should continue this conversation later | deferred resume | usually passive unless paired with notification delivery | wakeup + conversation |
| Scheduled automation completes later | task activity, optionally callback into a conversation | passive by default | task log + activity + optional conversation wakeup |
| High-signal blocked or failed background work | reminder/callback notification, often with activity too | inbox notification + optional browser/companion delivery | conversation or activity plus logs |

## Inbox / activity

Use activity when something happened and it is worth noticing later, but does not need to interrupt.

Good fits:

- scheduled task output
- background failures worth reviewing later
- daemon/system events worth surfacing
- async work that finished outside the foreground thread

If the event belongs to a known conversation, keep the durable result with that conversation and surface the conversation in the inbox instead of creating a duplicate visible row by default.

See [Inbox and Activity](./inbox.md).

## Reminders and notification delivery

Use reminder-driven notification delivery when the event should be harder to miss.

Good fits:

- user-requested reminders
- approval-needed callbacks
- blocked or failed background work that needs immediate attention
- scheduled-task callbacks that should be hard to miss

These notifications no longer get a separate in-app surface. They show up as normal inbox rows, and can additionally trigger browser/companion notifications when enabled.

See [Reminders and Notification Delivery](./alerts.md).

## Deferred resume

Use deferred resume when the agent should come back to the same conversation later.

This is the right fit for:

- continue checking later
- try again after waiting
- resume a thread when time has passed
- stage unattended multi-step work that should return here later

Use deferred resume when the user does **not** need a direct reminder. If the user explicitly wants "tell me later," use a reminder instead.

Use deferred resume for conservative background review of a thread when needed — with a high bar and a no-op default.
The first-pass outcomes should stay narrow: no-op, note update, or linked project update.

## Scheduled-task callbacks

Scheduled tasks stay passive by default.

They:

- run through the daemon
- write logs and durable run state
- create activity

When explicitly bound back to a conversation, they can also create:

- a conversation wakeup
- a stronger inbox notification
- linked activity

That is the right fit for things like:

- run this later and tell me what happened
- keep watching and bring this thread back when it matters

## Practical routing rules

Use these defaults:

- **foreground work** stays in the conversation
- **standalone async work** becomes activity
- **async work tied to a dormant conversation** surfaces the conversation
- **user-requested tell-me-later behavior** becomes a reminder with notification delivery
- **agent-initiated continue-later behavior** becomes deferred resume


## What not to do

Do not:

- turn every reply into inbox activity
- use reminder/callback notification delivery for ordinary passive async summaries
- store the durable record only in the notification layer
- use reminders when a scheduled task or deferred resume is the real need
- copy conversation ids into portable durable files

## Related docs

- [Decision Guide](./decision-guide.md)
- [Inbox and Activity](./inbox.md)
- [Reminders and Notification Delivery](./alerts.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Conversations](./conversations.md)
