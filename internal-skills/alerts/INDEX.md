---
id: alerts
kind: internal-skill
title: Reminders and Notification Delivery
summary: Built-in guidance for reminder-backed notification delivery, callbacks, and stronger async attention.
tools:
  - reminder
---

# Reminders and Notification Delivery

This page covers the reminder/callback notification path that still uses internal alert records under the hood.

The important product change is simple:

- there is **no separate in-app alerts surface** anymore
- current desktop/web surfaces do **not** render alert rows
- current desktop/web surfaces do **not** deliver popup/browser notifications for alerts

## What this path is for

Good fits:

- user-requested reminders
- approval-needed wakeups
- scheduled-task callbacks that should be easy to notice
- high-signal blocked or failed background work tied back to a conversation

If something does not need stronger delivery, keep it on the owning conversation or automation surface.

## Relationship to other async features

### Owning surfaces

- there is no shared in-app inbox
- alert records may still exist under the hood for wakeup state

If something should stay visible to the user, prefer the owning conversation, automation surface, or conversation attention on the owning thread.

### Deferred resume

Deferred resume is still the conversation wakeup mechanism:

> bring this conversation back later with this prompt

Reminders use the same wakeup path, but default to stronger notification delivery.

### Scheduled tasks

Scheduled tasks stay passive by default.

When a task is explicitly bound back to a conversation, its completion/failure can create:

- a conversation wakeup
- conversation attention when appropriate
- thread-owned follow-up state on that conversation

## Lifecycle

Internally, reminder/callback notifications still move through these states:

- `active`
- `acknowledged`
- `dismissed`

Active items remain internal alert state unless they are separately surfaced through activity or conversation attention.

Wakeup-backed notifications can also be **snoozed**, which acknowledges the current notification and reschedules the underlying wakeup for later.

Acknowledging or dismissing a notification does **not** delete the durable history.

## Web UI

The current web UI does not surface reminder/callback alerts directly.

If async work should remain visible, route it through the owning conversation or automation surface.

## Practical rule of thumb

Use:

- **reminder** only when you specifically need wakeup/alert state semantics under the hood
- **conversation_queue** when the agent should continue later without the user having to remember
- **scheduled task** when unattended automation should run later
- **conversation attention** for passive async outcomes on an owning thread
- **conversation attention** when something should remain visible in the current UI

## Related docs

- [Async Attention and Wakeups](../async-attention/INDEX.md)
- [Shared Inbox Removal](../inbox/INDEX.md)
- [Conversations](../../docs/conversations.md)
- [Scheduled Tasks](../scheduled-tasks/INDEX.md)
