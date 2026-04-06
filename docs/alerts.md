# Reminders and Notification Delivery

This page covers the reminder/callback notification path that still uses internal alert records under the hood.

The important product change is simple:

- there is **no separate in-app alerts surface** anymore
- reminder and callback notifications appear **inline in the inbox**
- stronger delivery now mainly means **browser/companion notifications** and reminder-specific inbox actions such as snooze or dismiss

## What this path is for

Good fits:

- user-requested reminders
- approval-needed wakeups
- scheduled-task callbacks that should be easy to notice
- high-signal blocked or failed background work tied back to a conversation

If something does not need stronger delivery, keep it as ordinary inbox/activity.

## Relationship to other async features

### Inbox/activity

- **Inbox** = the in-app attention queue
- **Notification delivery** = stronger delivery layered on top of an inbox item or conversation wakeup

An inbox notification may still have a matching activity record for history/audit.

### Deferred resume

Deferred resume is still the conversation wakeup mechanism:

> bring this conversation back later with this prompt

Reminders use the same wakeup path, but default to stronger notification delivery.

### Scheduled tasks

Scheduled tasks stay passive by default.

When a task is explicitly bound back to a conversation, its completion/failure can create:

- a conversation wakeup
- an inbox notification row
- a linked activity record
- browser/companion notifications when enabled and warranted

## Lifecycle

Internally, reminder/callback notifications still move through these states:

- `active`
- `acknowledged`
- `dismissed`

Active items appear in the inbox.

Wakeup-backed notifications can also be **snoozed**, which acknowledges the current notification and reschedules the underlying wakeup for later.

Acknowledging or dismissing a notification does **not** delete the durable history.

## Web UI

The web UI exposes reminder/callback notifications through:

- the **Inbox** page's unified notification list
- per-row actions such as open, mark read, dismiss, and snooze when available
- browser/companion notifications when explicit notification records arrive and permission has already been granted

The desktop web UI also prompts you to enable browser notifications when active reminder/callback notifications exist and browser notifications are still off.

## Practical rule of thumb

Use:

- **reminder** when the user wants "tell me later"
- **deferred resume** when the agent should continue later without the user having to remember
- **scheduled task** when unattended automation should run later
- **inbox/activity** for passive async outcomes
- **notification delivery** when something should be harder to miss, not when it needs a second in-app surface

## Related docs

- [Async Attention and Wakeups](./async-attention.md)
- [Inbox and Activity](./inbox.md)
- [Conversations](./conversations.md)
- [Scheduled Tasks](./scheduled-tasks.md)
