---
id: inbox
kind: internal-skill
title: Shared Inbox Removal
summary: The shared inbox model has been removed; async outcomes now live on their owning surfaces.
---

# Shared Inbox Removal

`personal-agent` no longer has a shared inbox as a product surface.

Use these owners instead:

- conversation-linked async work → the conversation thread and conversation attention state
- automation-linked work → the automation detail view and its owning thread
- detached run state → the owning conversation/thread
- reminders/alerts → wakeup and alert delivery pointing back to the owning thread

Do not design new flows around standalone inbox rows, `pa inbox`, or a shared async triage queue.

If you are looking for the old guidance, use these instead:

- [Async Attention and Wakeups](../async-attention/INDEX.md)
- [Reminders and Notification Delivery](../alerts/INDEX.md)
- [Runs](../runs/INDEX.md)
- [Scheduled Tasks](../scheduled-tasks/INDEX.md)
- an archived conversation reaches a decision point
- an autonomous run attached to a conversation fails
- a deferred resume wakes a dormant conversation back up

Preferred behavior:

1. update the conversation and related artifacts
2. surface the conversation as needing attention
3. optionally notify

### Asynchronous work with no conversation

If the event does not belong to an existing conversation, create a **standalone inbox activity item**.

Examples:

- scheduled tasks
- background verification jobs not tied to a chat
- daemon/system events worth surfacing
- external events that do not yet belong to a conversation

---

## What belongs in the inbox

Good inbox material is:

- asynchronous
- not already obvious in the active foreground UI context
- worth noticing later
- important enough to keep, but not so urgent that it needs an alert

Typical examples:

- output from scheduled/background tasks
- verification results that matter
- failures from autonomous or background work
- deferred resume activations
- external inbound events/messages not otherwise surfaced
- dormant/archived conversations that now need attention
- conversation states that require a human decision or unblock

---

## What does not belong in the inbox

The inbox should not contain:

- every assistant reply
- low-level tool progress
- noisy internal bookkeeping
- every project update
- full logs when a short summary plus pointer is enough
- duplicate content that is already visible in the active conversation

Bad examples:

- "Read 3 files"
- "Started thinking"
- "Updated 2 lines"
- "Still working..."

---

## Current product behavior

This is the implemented behavior today.

### Web UI notification center

The web notification center combines:

1. **standalone unread/read activity items** that are not tied to a known conversation
2. **archived conversations needing attention**

Open conversations already have a visible place in the sidebar, so they are shown there with attention dots instead of being duplicated in the inbox list.

### Conversation attention in the web UI

A conversation can need attention because of either:

- new messages since it was last marked read, or
- unread linked activity newer than the conversation's last read timestamp

When the user opens a conversation in the web UI, the conversation attention state is cleared automatically and that read state syncs across machines.

### Standalone activity in the web UI

Standalone activity stays in the notification center until it is marked read or culled by retention.

### Reminder and callback notifications in the web UI

Current web surfaces do not render reminder/callback alert rows.

If something should remain visible, create activity or surface the conversation instead.

### Linked activity behavior

If an activity item is linked to a known conversation, the inbox surfaces the **conversation** instead of duplicating that activity row in the inbox list.

The activity item still exists durably; it is simply not rendered as a separate inbox row when the conversation can be surfaced directly.

---

## CLI behavior

`pa inbox` operates on the inbox as a surfaced attention model.

### List inbox items

```bash
pa inbox
pa inbox list
pa inbox list --json
pa inbox list --unread
pa inbox list --all
pa inbox list --activities
pa inbox list --conversations
```

Behavior:

- lists **standalone surfaced activity**
- lists **conversations needing attention**
- hides conversation-linked activity rows when the linked conversation can be surfaced directly

Selector/filter notes:

- `--read` / `--unread` apply to the surfaced inbox view
- conversations are only listed when they currently need attention
- `--activities` and `--conversations` limit the surfaced kinds shown

### Show one inbox item

```bash
pa inbox show activity:daily-report
pa inbox show conversation:conv-123
pa inbox show daily-report
```

Selector forms:

- `activity:<id>`
- `conversation:<id>`
- bare activity id when unambiguous

### Create a standalone inbox activity item

```bash
pa inbox create "Daily report ready"
pa inbox create "Verification failed" --kind verification --details "3 tests failed"
pa inbox create "Follow up later" --conversation conv-123
```

`create` creates a durable **activity item**.

If the item is linked to a known conversation with `--conversation`, the inbox may later surface the linked conversation instead of the raw activity row.

### Mark inbox items read or unread

```bash
pa inbox read activity:daily-report
pa inbox read conversation:conv-123
pa inbox read --all

pa inbox unread activity:daily-report
pa inbox unread conversation:conv-123
```

Behavior:

- reading an **activity** updates the profile activity read-state
- reading a **conversation** updates the conversation attention state
- unread on a conversation forces it back into attention

### Delete a standalone activity item

```bash
pa inbox delete activity:daily-report
pa inbox delete daily-report
```

Only **activity items** can be deleted.

Conversations cannot be deleted via `pa inbox`; mark them read instead.

---

## Durable storage

### Activity items + read-state

Standalone activity items and their read-state live together in local runtime sqlite at:

- `~/.local/state/personal-agent/pi-agent/state/inbox/<profile>/runtime.db`

These records are machine-local and are not shared between devices.

### Activity → conversation links

Local mutable runtime links live at:

- `~/.local/state/personal-agent/pi-agent/state/activity-conversation-links/<profile>/<activity-id>.json`

These links let an activity item point to one or more conversations without forcing the activity markdown file to be the only source of truth for surfacing behavior.

### Conversation attention state

Durable conversation attention state lives at:

- `~/.local/state/personal-agent/sync/pi-agent/state/conversation-attention/<profile>.json`

This state tracks the conversation's acknowledged message count and last attention-read timestamp.

It is used to determine whether a conversation should surface in the inbox again after reloads and restarts.

---

## Attention semantics

A conversation currently needs attention when at least one of these is true:

- it has new messages since its acknowledged message count
- it has linked unread activity newer than its last attention-read timestamp
- it was manually forced unread

A standalone activity item needs attention when it is unread and not being represented by a surfaced linked conversation.

---

## Notifications vs inbox

Default policy:

- create inbox/conversation surfacing first
- notify only when warranted

Typical notification-worthy cases:

- failures
- urgent or time-sensitive events
- user-requested reminders/follow-ups
- high-signal external events

The fact that something is not currently visible in the web UI is **not by itself** enough reason to notify.

The real question is whether the event is already sufficiently surfaced somewhere you are likely to see.

### Internal system event defaults

These defaults are intentionally conservative.

| Event | Default durable surfacing | Default interrupting notification |
| --- | --- | --- |
| Application restart complete | unread inbox activity when the managed restart finishes | none |
| Application restart failed | unread inbox activity | maybe |
| Daemon auto-restarted to match the active profile | none by default | none |
| Daemon became unhealthy or later recovered | unread inbox activity only after a sustained issue | usually none |
| Gateway became unhealthy or later recovered | unread inbox activity | usually none |
| Ordinary manual service actions or config saves | none beyond the initiating surface | none |

Practical rule:

- **write unread inbox activity for async or out-of-band internal events that are actually worth follow-up**
- **reserve interrupting notifications for high-signal failures or disruptive background events**
- **do not notify just because something happened somewhere in the system or because a planned restart completed**

---

## Decision table

| Situation | Durable home | Inbox behavior | Notification default |
| --- | --- | --- | --- |
| Normal reply in active conversation | conversation | none | none |
| Tool output during active conversation | conversation | none | none |
| Background task with no conversation | activity item | create standalone inbox item | optional |
| Background work tied to inactive/archived conversation | conversation + artifacts | surface the conversation | optional |
| Deferred resume fires for dormant conversation | conversation | surface the conversation | usually none |
| Verification failure not tied to conversation | activity item | create standalone inbox item | maybe |
| External event tied to inactive conversation | conversation | surface the conversation | optional |
| External event with no conversation yet | new conversation or activity item | surface in inbox | optional |

---

## Summary

The notification center is the passive attention layer for asynchronous things.

In practice, that means:

- **foreground work stays in the conversation**
- **standalone async work becomes activity**
- **async work tied to a dormant conversation surfaces the conversation**
- **notification delivery can make an inbox item harder to miss, but it is not the durable record itself**

## Related docs

- [Async Attention and Wakeups](../async-attention/INDEX.md)
- [Reminders and Notification Delivery](../alerts/INDEX.md)
- [Conversations](../../docs/conversations.md)
- [Scheduled Tasks](../scheduled-tasks/INDEX.md)
