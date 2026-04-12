---
id: async-attention
kind: internal-skill
title: Async Attention and Wakeups
summary: Built-in routing guide for conversation queueing, reminders, owning surfaces, and later attention.
tools:
  - conversation_queue
  - reminder
  - activity
  - scheduled_task
---

# Async Attention and Wakeups

This page explains how `personal-agent` surfaces work that matters later.

The core distinction is:

- **in-app attention** → owning conversations and automations that need attention
- **stronger delivery** → currently suppressed in the desktop/web UI; do not rely on popup/browser notifications
- **conversation continuation** → queued continuations and wakeups

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

That is where owning conversations, automations, and alerts surface the async state that matters.

### 3. Wakeup behavior

A wakeup answers:

> should a conversation continue later, and with what prompt?

Conversation queue items, reminders, and some scheduled-task callbacks use this layer.

## Choose the right async surface

| Need | Use | Attention style | Durable home |
| --- | --- | --- | --- |
| Passive async summary tied to owned work | surface the owning conversation or automation | passive | conversation/automation + logs |
| Async result tied to an inactive conversation | surface the conversation | passive by default | conversation + logs |
| Human reminder that should interrupt | reminder | currently hidden in the desktop/web UI; prefer surfaced conversation attention or OS delivery when visibility matters | wakeup + notification state |
| Agent should continue this conversation later | conversation_queue | usually passive unless paired with notification delivery | live queue/wakeup + conversation |
| Scheduled automation completes later | automation-owned run history, optionally callback into a conversation | passive by default | task log + owning thread + optional conversation wakeup |
| High-signal blocked or failed background work | surfaced conversation attention, optionally with reminder state under the hood | visible on the owning thread | conversation plus logs |

## Owning surfaces

There is no shared inbox or generic activity queue.

If something happened and it is worth noticing later, keep it on its owner:

- scheduled task output → automation detail + owning thread
- background failures → owning conversation/thread
- async work that finished outside the foreground thread → owning conversation/thread
- daemon/system issues → diagnostics or selective OS notification

See [Shared Inbox Removal](../inbox/INDEX.md).

## Reminders and notification delivery

Use reminder-driven notification delivery when the event should be harder to miss.

Good fits:

- user-requested reminders
- approval-needed callbacks
- blocked or failed background work that needs immediate attention
- scheduled-task callbacks that should be hard to miss

The current desktop/web UI does not render these notifications as standalone rows and does not trigger popup/browser delivery.

See [Reminders and Notification Delivery](../alerts/INDEX.md).

## Conversation queue

Use conversation_queue when the agent should come back to the same conversation later.

This is the right fit for:

- continue checking later
- try again after waiting
- resume a thread when time has passed
- queue the next step behind the current turn
- stage unattended multi-step work that should return here later

Use conversation_queue when the user does **not** need a direct reminder. If the user explicitly wants "tell me later," use a reminder instead.

For time-based follow-up, conversation_queue uses wakeup state under the hood. For immediate continuation after the current turn, it uses the live conversation queue.

## Scheduled-task callbacks

Scheduled tasks stay passive by default.

They:

- run through the daemon
- write logs and durable run state
- stay attached to their owning automation/thread

When explicitly bound back to a conversation, they can also create:

- a conversation wakeup
- surfaced conversation attention when appropriate

That is the right fit for things like:

- run this later and tell me what happened
- keep watching and bring this thread back when it matters

## Practical routing rules

Use these defaults:

- **foreground work** stays in the conversation
- **standalone async work** should get an owner instead of falling into a shared queue
- **async work tied to a dormant conversation** surfaces the conversation
- **user-requested tell-me-later behavior** should usually become surfaced conversation attention unless hidden reminder state is specifically needed
- **agent-initiated continue-later behavior** becomes conversation_queue


## What not to do

Do not:

- invent a shared inbox substitute for ordinary async work
- rely on hidden reminder/callback notification delivery for ordinary passive async summaries
- store the durable record only in the notification layer
- use reminders when a scheduled task or conversation_queue item is the real need
- copy conversation ids into portable durable files

## Related docs

- [Decision Guide](../../docs/decision-guide.md)
- [Shared Inbox Removal](../inbox/INDEX.md)
- [Reminders and Notification Delivery](../alerts/INDEX.md)
- [Scheduled Tasks](../scheduled-tasks/INDEX.md)
- [Conversations](../../docs/conversations.md)
