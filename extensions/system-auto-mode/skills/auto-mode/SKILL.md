---
name: goal-mode
description: Use when you have a goal to work toward across multiple turns, or when the user asks you to own a task and keep going without waiting for input.
metadata:
  id: goal-mode
  title: Goal Mode
  summary: Set a goal, track tasks, and let the system automatically continue until the objective is met.
  status: active
tools:
  - set_goal
  - update_goal
  - get_goal
  - update_tasks
---

# Goal Mode

Use this skill when you have a sustained objective that may span multiple turns.

Goal mode replaces auto mode's nudge/mission/loop modes with a single concept: set an objective, work toward it, and the system will automatically schedule a continuation turn when you go idle with an active goal.

## How it works

1. **`set_goal`** — create a concrete objective. Optionally include a task list for tracking sub-steps. Fails if a goal is already active — mark it complete first.
2. **`update_goal(status: "complete")`** — mark the goal achieved when the objective is met.
3. **`get_goal`** — read the current goal, status, tasks, and progress.
4. **`update_tasks`** — update task statuses as you work (in_progress, done, blocked, pending).

The system automatically schedules a continuation turn after each turn while the goal is active.

## Rules

- Do not create a goal for every ordinary request — only for sustained multi-turn tasks.
- Keep tasks current: mark them in_progress before starting, done as soon as finished.
- Mark the goal complete with `update_goal` only when the objective is actually achieved.
- The system's continuation prompt includes the objective and remaining tasks.

## No-tool suppression

If a continuation turn produces no tool calls (just chat), the next automatic continuation is skipped. Starting or completing a goal resets this.
