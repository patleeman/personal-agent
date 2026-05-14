---
name: goal-mode
description: Use when you have a goal to work toward across multiple turns, or when the user asks you to own a task and keep going without waiting for input.
metadata:
  id: goal-mode
  title: Goal Mode
  summary: Set one objective and let the system automatically continue until it is met.
  status: active
tools:
  - set_goal
  - update_goal
---

# Goal Mode

Use this skill when you have a sustained objective that may span multiple turns.

Goal mode is a single active objective. The system injects the current objective into continuation turns and automatically schedules another turn while the goal is active.

## How it works

1. **`set_goal`** — enable goal mode with a concrete objective, or replace the active objective.
2. **`update_goal(objective: "...")`** — enable goal mode or replace the active objective.
3. **`update_goal(status: "complete")`** — disable goal mode when the objective is met.

The system automatically schedules a visible goal-continuation block after each turn while the goal is active, then uses it to trigger the next turn.

## Rules

- Do not create a goal for every ordinary request — only for sustained multi-turn tasks.
- Calling `set_goal` while goal mode is active replaces the objective and keeps goal mode running.
- Mark the goal complete with `update_goal` only when the objective is actually achieved.
- The system's continuation prompt already includes the current objective.

## Safety guards

If goal-mode turns produce no tool calls for two consecutive turns, goal mode is disabled with `stopReason: "no progress"` so it cannot spin forever. Starting, updating, or completing a goal resets this.

Queued continuations are cancelled or ignored when the goal changes or completes, and duplicate completion calls are treated as no-ops. Completing a goal does not abort the current turn; it prevents the agent-end scheduler from queuing another continuation. Turn-end events only update progress counters, so tool-heavy runs cannot stack stale continuations before completion. Goal mode should end quietly once the objective is complete.
