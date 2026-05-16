---
name: async-attention
description: Use when deciding between follow-up queues, scheduled callbacks, automation-owned attention, wakeups, and async follow-up surfaces.
metadata:
  id: async-attention
  title: Async Attention and Wakeups
  summary: Built-in routing guide for follow-up queues, owning surfaces, and later attention.
  status: active
tools:
  - queue_followup
  - activity
  - scheduled_task
---

# Async Attention and Wakeups

Use the smallest scheduling surface that matches the owner of the work.

## Choose the right surface

| Need                                               | Use                                  | Durable home                  |
| -------------------------------------------------- | ------------------------------------ | ----------------------------- |
| Agent should continue this conversation later      | `queue_followup`                     | live queue or deferred resume |
| Unattended automation should run later or recur    | `scheduled_task`                     | automation store + run logs   |
| Passive async result tied to a thread              | surface the owning conversation      | conversation/activity         |
| Scheduled task result should come back to a thread | scheduled task conversation callback | task log + optional wakeup    |

There is no standalone reminder tool. Human “tell me later” requests are same-thread follow-ups unless they need a true app-wide automation.

## `queue_followup`

Use `queue_followup` when this same conversation should continue later.

Actions:

- `add` — queue a follow-up
- `list` — list pending follow-ups for this conversation
- `cancel` — cancel a queued follow-up by listed `id`

For `action: "add"`, always include `trigger`:

- `trigger: "after_turn"` queues work after the current turn; do not include `delay` or `at`.
- `trigger: "delay"` queues a later continuation; include compact duration syntax like `30s`, `10m`, `2h`, `4h`, or `1d`.
- `trigger: "at"` queues a later continuation for a specific timestamp or human time phrase.

Example:

```json
{
  "action": "add",
  "trigger": "delay",
  "delay": "4h",
  "deliverAs": "followUp",
  "title": "Check release state",
  "prompt": "Wake up and check whether the release is ready. If it is still blocked, requeue instead of asking the user."
}
```

Use `queue_followup` with `action: "list"` before assuming no wakeups are pending.

## `scheduled_task`

Use `scheduled_task` for app-wide recurring or one-time automations, especially work that can run without this conversation being active.

## Do not

- invent a shared inbox substitute for ordinary async work
- use scheduled tasks for a simple same-thread follow-up
- store async state only in notification/alert state
- copy conversation ids into portable durable files
