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

1. **`set_goal`** — create the objective when goal mode is not already active.
2. **`update_goal(objective: "...")`** — replace the active objective when the goal changes.
3. **`update_goal(status: "complete")`** — mark the goal achieved when the objective is met.

The system automatically schedules a continuation turn after each turn while the goal is active.

## Rules

- Do not create a goal for every ordinary request — only for sustained multi-turn tasks.
- Do not call `set_goal` when a goal is already active; update the objective instead.
- Mark the goal complete with `update_goal` only when the objective is actually achieved.
- The system's continuation prompt already includes the current objective.

## No-tool suppression

If continuation turns produce no tool calls, automatic continuation is suppressed after two no-progress turns. Starting, updating, or completing a goal resets this.
