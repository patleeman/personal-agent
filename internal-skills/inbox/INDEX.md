---
id: inbox
kind: internal-skill
title: Shared Inbox Removal
summary: The shared inbox model has been removed; async outcomes now live on their owning surfaces.
---

# Shared Inbox Removal

`personal-agent` no longer has a shared inbox.

There is no product workflow built around standalone inbox rows, `pa inbox`, or a shared async triage queue. Do not design new features around those concepts.

## Own the event where it belongs

Use these owners instead:

- conversation-linked async work → the conversation thread and conversation attention state
- automation-linked work → the automation detail view and its owning thread
- durable runs → the owning conversation/thread
- reminders and approvals → wakeup/alert state that points back to the owning thread
- system/daemon issues → diagnostics, logs, or selective OS notifications

If something currently has no owner, create one. Do not fall back to a generic shared inbox item.

## Practical rules

- append durable async results to the owning conversation whenever possible
- use conversation attention for passive follow-up on thread-owned work
- use reminders/alerts only when stronger delivery is actually needed
- keep automation history on the automation and its thread
- keep run history on the owning thread

## What to avoid

Do not:

- create standalone inbox activity as a user workflow
- duplicate thread-owned state into a second attention queue
- treat notification delivery as the durable record
- route normal async work through ownerless shared activity entries

## Related docs

- [Async Attention and Wakeups](../async-attention/INDEX.md)
- [Reminders and Notification Delivery](../alerts/INDEX.md)
- [Runs](../runs/INDEX.md)
- [Scheduled Tasks](../scheduled-tasks/INDEX.md)
- [Conversations](../../docs/conversations.md)
