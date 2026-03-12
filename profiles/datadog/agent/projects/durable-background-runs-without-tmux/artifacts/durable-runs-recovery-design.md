# Durable runs recovery design

Date: 2026-03-12
Project: `durable-background-runs-without-tmux`

## Problem

Today local background orchestration is split across three weak models:

1. **tmux-managed detached jobs** for ad hoc long-running work
2. **daemon scheduled tasks** that still have optional tmux execution paths
3. **web-owned live sessions** that die when the web process restarts

This does not satisfy the actual durability requirement.

The requirement is **not** “keep the original process alive.”
The requirement is:

> if the system stops and later comes back, background work should resume or rerun from the last durable boundary instead of starting from scratch blindly or disappearing.

That means the system needs **workflow durability**, not process durability.

## Explicit v1 non-goals

These are intentionally out of scope for the first version:

- exact mid-token model continuation
- exact mid-command shell continuation
- exactly-once tool execution guarantees
- generic automatic resume for arbitrary opaque shell commands
- preserving the original worker process across daemon restart

V1 should instead recover from **durable checkpoints and run state**.

## Main architecture decision

Treat background work as a **durable run** with persisted state and recovery policy.

The daemon becomes:

- the run registry
- the scheduler
- the recovery engine
- the public control plane for inspection, logs, cancellation, and restart recovery

Workers become disposable execution processes. If one dies, a fresh worker can be started from persisted run state.

## Core model: durable runs

Each unit of background work becomes a run with:

- `id`
- `kind`
- `status`
- `resumePolicy`
- `spec`
- `attempts`
- `checkpoint`
- `artifacts`
- `timestamps`

Suggested state root:

- `~/.local/state/personal-agent/daemon/runs/<run-id>/`

Suggested files:

- `manifest.json` — immutable run definition and launch spec
- `status.json` — current state, active attempt, recovery metadata
- `events.jsonl` — append-only lifecycle journal
- `checkpoint.json` — latest durable checkpoint
- `output.log` — human-readable output
- `result.json` — final outcome when complete

Optional later files:

- `snapshot.json` for richer conversation state
- `queue.json` for pending conversation actions
- `tool-calls.jsonl` for explicit tool reconciliation

## Run statuses

Suggested initial statuses:

- `queued`
- `running`
- `recovering`
- `waiting`
- `completed`
- `failed`
- `cancelled`
- `interrupted`

`interrupted` means a previous attempt stopped unexpectedly and has not yet been recovered.

## Resume policies

V1 should support explicit recovery semantics per run:

- `rerun` — restart from the beginning
- `continue` — continue from the last durable checkpoint
- `manual` — do not auto-restart; surface the interruption for attention

These are policies on the **run kind**, not promises that arbitrary child processes can magically resume.

## Run kinds

Initial useful run kinds:

### 1. Scheduled task run

Created by the daemon tasks module from a `*.task.md` definition.

Default recovery policy:

- usually `rerun` for prompt-style tasks
- optionally `continue` later if task execution becomes step-based

### 2. Conversation run

Represents a durable live conversation runtime.

Default recovery policy:

- `continue`

Continuation here means rebuilding from persisted transcript + snapshot + pending action queue, not exact token-state continuation.

### 3. Background workflow run

A first-class multi-step daemon run for detached work that is designed for checkpoints.

Default recovery policy:

- `continue`

### 4. Raw shell run

If supported at all in v1, this should be honest and limited.

Default recovery policy:

- `manual` or `rerun`

It must **not** claim true mid-command resume.

## Durable boundaries

Recovery only works if the run has safe commit points.

The model should be:

- do work for a step
- commit results/checkpoint
- advance status

If the daemon stops mid-step, recovery restarts the step or continues from the last committed boundary.

This is the core contract for restart durability.

## Recovery algorithm

On daemon startup:

1. scan `daemon/runs/*`
2. load `manifest.json`, `status.json`, and `checkpoint.json` where present
3. classify each incomplete run
4. decide recovery action based on `resumePolicy`
5. enqueue recovery work or mark the run as needing attention

Suggested rules:

### `resumePolicy=continue`

- create a fresh worker
- restore the latest checkpoint
- continue from the first incomplete durable step

### `resumePolicy=rerun`

- create a fresh attempt
- restart from step 1 or the run’s defined start point

### `resumePolicy=manual`

- mark the run `interrupted`
- write durable activity/inbox surfacing
- do not auto-restart

## Scheduled tasks migration

The tasks module should stop being a direct executor.

Instead:

- `packages/daemon/src/modules/tasks.ts` remains the scheduler and task-state manager
- when a run is due, it creates a durable run record
- the runs subsystem executes and recovers it

This unifies scheduled tasks with the general durability model.

As part of this migration, remove tmux-specific scheduling/execution behavior:

- `runInTmux` in task frontmatter
- `runTasksInTmux` in daemon config
- the tmux branch in `packages/daemon/src/modules/tasks-runner.ts`

## Web-triggered task execution

The current path in `packages/web/server/index.ts` for `POST /api/tasks/:id/run` creates a live session in the web process.

That should move to the daemon-backed runs / durable conversation path so it survives web restarts.

## Conversation recovery model

The previous conversation-worker direction assumed a long-lived live owner process.

For restart recovery, the conversation model should instead persist enough state for a **fresh worker** to reconstruct the live runtime.

Per conversation, persist at least:

- `conversationId`
- `sessionFile`
- `profile`
- `cwd`
- `status`
- `snapshot.json`
- `events.jsonl`
- pending control actions such as prompt / steer / follow-up / abort

On recovery:

- rebuild from the session transcript and persisted snapshot
- restore pending action queue
- continue from the last safe turn/tool boundary
- do not promise exact mid-token continuation

This makes conversations consistent with the durable runs model.

## Tool execution semantics

Exactly-once tool execution is out of scope for v1, but recovery still needs basic discipline.

The minimum safe model is:

- persist tool start metadata
- persist tool completion metadata before committing its result into the durable conversation/run state
- on recovery, rerun only work whose result was not durably committed

This gives acceptable v1 behavior without solving the full exactly-once problem.

## Logs, notifications, and inspectability

Run logs and lifecycle events must be durable.

Requirements:

- log output survives daemon restart
- run history is inspectable without the original worker process
- completion/failure surfacing can be regenerated from run state

The existing in-memory daemon notification queue should eventually become a durable spool so restart recovery does not lose background notifications.

## Product surface migration

Once the durable runs engine exists, tmux should stop being the first-class local orchestration path.

Planned replacements:

- CLI: `pa runs ...` replaces `pa tmux ...`
- gateway: a run/jobs command replaces `/tmux ...`
- web: background work routes through daemon-backed runs or durable conversations

Remote-host documentation that happens to recommend tmux for remote shells can remain separate from local orchestration policy.

## Initial implementation order

### Milestone 1: refine the plan

- define run files and state model
- define resume policies and recovery rules
- define runs IPC surface
- revise conversation durability design around recovery-from-state
- map tmux cleanup path

### Milestone 2: execute the work

- implement run store and recovery scanner
- add runs IPC + initial CLI
- route scheduled tasks through runs
- move web task-triggered background work onto the daemon
- migrate conversations to the recovery model
- remove tmux-first local orchestration paths

### Milestone 3: verify the result

- add restart recovery tests for runs
- add restart recovery tests for conversations
- verify tmux cleanup and replacement surface parity

## Success criteria

This project is successful when:

- scheduled/background work no longer depends on tmux
- daemon restart no longer loses in-flight work definition
- durable runs either continue, rerun, or surface as interrupted according to policy
- web-triggered background work survives web restarts
- live conversations recover from persisted state rather than process ownership
- the repo has a clear path to remove tmux as a first-class local orchestration feature
