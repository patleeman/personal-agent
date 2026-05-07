---
id: auto-mode
kind: internal-skill
title: Auto Mode
summary: Built-in guide for autonomous conversation continuation, validation, durable runs, and disciplined follow-through.
tools:
  - conversation_auto_control
  - conversation_queue
  - run
  - checkpoint
---

# Auto Mode

Use this internal skill when the user enables auto mode or asks the agent to take ownership of a task and keep moving without frequent check-ins.

Auto mode is for work that may span:

- multiple continuation turns
- durable runs
- one or more wakeups
- overnight progress
- validation and checkpointing

## Core rule

Autonomy is only useful if the agent stays both **controlled** and **tenacious**.

Auto mode should be driven by a visible, bounded **mission**, not by vague self-selection. The mission is the current goal auto mode is allowed to pursue inside the conversation. It can be explicit from the user or inferred from the active request, but it should be inspectable and editable instead of hidden agent vibes.

That means:

- keep scope narrow per step
- define the active mission before continuing autonomously
- keep one clear state file when work spans turns or wakeups
- validate real behavior, not just code shape
- keep at most one active deferred resume for the same task thread
- push through fixable failures instead of stopping at the first bump
- stop and report concrete blockers instead of thrashing

## Mission model

Auto mode has a current mission:

```ts
{
  enabled: true,
  mission: 'Rebase the two iOS reliability commits onto origin/master, validate tests, and report blockers.',
  mode: 'normal' | 'tenacious' | 'forced',
  budget?: {
    maxTurns?: number,
    until?: string,
  },
  stopWhen: ['goal_complete', 'needs_user_input', 'external_blocker', 'budget_exhausted'],
}
```

The mission is narrower than the whole conversation. A conversation might be broadly about the iOS app, while the auto mission is specifically “continue the chat reliability pass through reconnect/resubscribe validation.”

### Deriving the mission

When auto mode is enabled, derive the mission from the strongest available source:

1. explicit slash-command text, for example `/auto tenacious until tests pass: fix reconnect bugs`
2. the current pending user request
3. recent thread context and summaries

If confidence is low, do not start silently. Ask for a mission or show an editable draft. Hidden inferred goals are a bad product smell.

### Mode semantics

- `normal`: continue when meaningful work remains and stop when the mission appears satisfied.
- `tenacious`: continue unless there is a concrete terminal reason: complete, needs user input, external blocker, or validation failure that changes scope.
- `forced`: continue until the mission is complete, a hard blocker appears, or the explicit budget is exhausted.

Avoid unbounded forced loops. They are useful as a pressure relief valve when the model is being lazy, but they should always have a turn, time, or completion budget.

## Auto mode controller behavior

When auto mode is enabled, the backend performs a hidden review turn after each visible assistant turn.

That hidden controller turn must call `conversation_auto_control` exactly once:

- use `action="continue"` when meaningful work remains and the agent can still make progress
- use `action="stop"` only when the requested task is complete, blocked on a real dependency, or needs user input

The controller should judge against the active mission. “I made progress” is not a stop condition. In tenacious or forced mode, weak stops should be rejected unless the stop reason is tied to a terminal category.

Preferred structured stop shape:

```ts
{
  action: 'stop',
  reason: 'Focused iOS regressions pass; full suite has unrelated existing failures.',
  stopCategory: 'complete' | 'blocked' | 'needs_user' | 'budget_exhausted',
  confidence: 0.9,
}
```

The hidden review turn should not do the work itself and should not call other tools. Its job is only to decide whether the conversation should continue.

If it continues, the next continuation turn should resume the current user request from where the agent left off and take the next concrete step that best advances the task.

## Tenacity standard

Auto mode should feel like a careful teammate staying with the problem, not a loop that gives up when the happy path fails.

Default posture:

- inspect the actual result, not just the command exit code
- retry or route around transient failures when reasonable
- investigate the next obvious cause before declaring a blocker
- check edge cases and integration seams that commonly hide bugs
- verify the final state matches the user's request, not just that code changed
- leave no obvious stone unturned before stopping

Tenacity does **not** mean expanding scope. Do not add features, redesign unrelated areas, or polish things the user did not ask for. It means deeper attention to detail inside the requested goal.

## State file

Use a file to carry progress forward when the task spans multiple turns, wakeups, or durable runs.

Preferred order:

1. existing project `PLAN.md` if the repo already uses it as the working plan
2. repo-local `AUTO_MODE.md` if no suitable project plan exists

The file should stay short and operational. Keep these sections current:

```md
# Auto Mode State

## Goal

One-sentence task goal.

## Current status

What is done, what is in progress, what is blocked.

## Active run

- run id
- task slug
- purpose

## Latest validation

- last successful checks
- last visual validation

## Active deferred resume

- id
- why it exists
- when it should wake up

## Next step

The next smallest correct action.
```

Update the file when:

- a run starts
- a run finishes
- validation succeeds or fails
- the blocker changes
- the next step changes

## Durable run rules

Use durable runs for multi-step implementation work.

Rules:

- one focused run per milestone or subtask
- do not launch overlapping runs for the same files unless replacing a stalled run
- if a run stalls with no useful output, inspect the current worktree before deciding whether to cancel
- if the worktree contains useful partial progress, continue from it instead of restarting cold
- if retries keep failing for infrastructure reasons, take over directly if that is the smallest reliable path

Each run prompt should include:

- exact scope boundary
- files or state to reuse
- required validation
- commit/push requirement if green
- instruction to stop with a concrete blocker if the prerequisite is missing

## Validation requirement

Every autonomous step needs a real validation path.

Choose the smallest honest validation that proves the work:

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- build commands
- `cargo check`
- app launch validation
- `agent-browser` inspection
- screenshots for UI work

For UI work:

- validate the actual running app when possible, not just the source diff
- compare against the intended reference, not just “page renders”
- store screenshots in a predictable repo path when useful

Do not claim success if:

- the app only compiles but crashes at runtime
- the screenshot is blank or obviously broken
- validation was skipped because the run was inconvenient

## Deferred resume discipline

Deferred resumes are for waking the same conversation back up later.

Rules:

- maintain at most one active deferred resume per autonomous task thread
- do not schedule a new wakeup every time you inspect the same stuck task
- only replace the wakeup when timing materially changes
- record the current wakeup id in the state file
- if the task is blocked on the same external issue, do not create additional wakeups just to “stay alive”

### Current tooling limitation

In the current harness, the agent can schedule deferred resumes but does **not** have a first-class tool to list or cancel them.

So for now:

- treat the state file as the source of truth for the latest intended wakeup
- avoid stacking resumes
- if the user reports many queued resumes, stop scheduling new ones until the wakeup state is cleaned up

## When to stop autonomous progression

Stop and report if:

- the active mission is demonstrably complete
- the blocker is external and unchanged across retries
- the required runtime or credentials are missing
- validation fails in a way that changes the task shape materially
- the task is no longer matching the user's actual quality bar
- the explicit forced-mode budget is exhausted

Examples:

- model or rate-limit failures on every run
- missing API key or runtime dependency
- visual result is clearly off-target despite green checks

## Suggested workflow

1. Read the repo plan or create the state file.
2. Define the next smallest milestone.
3. Check for an already active run or stale partial worktree.
4. Launch one focused durable run, or take over directly if that is more reliable.
5. Validate honestly and inspect outputs with care.
6. Fix issues found during validation when they are within scope.
7. Update the state file.
8. Checkpoint if green.
9. Schedule one deferred resume only if more autonomous follow-up is actually needed.

## Good prompts to trigger this skill

- “Handle this autonomously.”
- “Keep going overnight.”
- “Own this and don’t stop unless blocked.”
- “Use runs and wakeups and keep track of progress.”
- “Set this up in auto mode.”

## Follow-up improvement worth adding to the product

The platform should expose deferred resume management directly.

Useful additions:

- list deferred resumes for the current conversation
- cancel a deferred resume by id
- replace an existing deferred resume instead of stacking a new one
- show active deferred resumes in the web UI and agent tool surface

## Related docs

- [Async Attention and Wakeups](../async-attention/INDEX.md)
- [Runs](../runs/INDEX.md)
- [Conversations](../../docs/conversations.md)
