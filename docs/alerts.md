# Alerts and Reminders

Alerts are `personal-agent`'s **interrupting attention surface**.

They exist for things that should be more disruptive than the inbox, while still keeping a durable local record.

## What alerts are for

Good fits:

- user-requested reminders
- approval-needed wakeups
- scheduled-task callbacks that should come back to the invoking conversation
- high-signal blocked/failed background work

Alerts are intentionally **sparse**.

If something does not need to interrupt you, it should usually stay in the inbox/activity layer instead.

## Relationship to other async features

### Inbox/activity

- **Inbox** = durable async history and follow-up surface
- **Alerts** = interrupting, ackable items that need attention now

An alert may also have a matching activity record for audit/history.

### Deferred resume

Deferred resume is the conversation wakeup mechanism.

It says:

> bring this conversation back later with this prompt

Reminders are built on the same conversation-wakeup path, but with alert delivery turned on.

### Scheduled tasks

Scheduled tasks are still unattended automation.

By default they remain passive:

- run later
- write logs
- create activity

When a task is explicitly bound back to a conversation, its completion/failure can create:

- a conversation wakeup
- an alert
- a linked activity record

## Reminder behavior

A reminder created from a conversation is conversation-bound.

When it fires, the system:

1. creates a ready wakeup for that conversation
2. creates an active alert
3. keeps the durable record in activity/state
4. auto-resumes the saved conversation if it is already open and the reminder allows that

## Alert lifecycle

Alerts move through these states:

- `active`
- `acknowledged`
- `dismissed`

`active` alerts show up in the inbox and, on the desktop web UI, in the right-hand context rail.

Wakeup-backed alerts can also be **snoozed**, which acknowledges the current alert and reschedules the underlying wakeup for later.

Acknowledging or dismissing an alert does **not** delete the underlying durable history.

## Web UI

The web UI exposes alerts through:

- the **Inbox** page's active alerts section
- the desktop right-hand context rail, including per-alert actions and a clear-all action
- browser/companion notifications when explicit alert records arrive and permission has already been granted

The desktop web UI now also prompts you to enable browser notifications the first time active alerts show up while browser alerts are still off.

## Practical rule of thumb

Use:

- **reminder** when the user wants "tell me later"
- **deferred resume** when the agent should continue later without the user having to remember
- **scheduled task** when unattended automation should run later
- **inbox** for passive async outcomes
- **alerts** for interrupting async outcomes

## Related docs

- [Async Attention and Wakeups](./async-attention.md)
- [Inbox and Activity](./inbox.md)
- [Conversations](./conversations.md)
- [Scheduled Tasks](./scheduled-tasks.md)
