# Conversation recovery addendum

Date: 2026-03-12
Project: `durable-background-runs-without-tmux`

## Why this addendum exists

The earlier daemon conversation runtime direction was optimized for:

- surviving **web** restart
- moving live ownership out of the web server
- using daemon-supervised per-conversation workers

That is still directionally correct, but it is not sufficient for the clarified durability requirement.

The clarified requirement is:

> after restart, the system should continue from durable state instead of depending on the original live worker process still existing.

So conversation durability should now be modeled as **restart recovery from persisted state**, not **continued ownership by an already-running child process**.

## Main design change

Replace the assumption:

- "one long-lived worker child process is the durable owner"

with:

- "one durable conversation run exists, and workers are disposable executors that rebuild from durable state"

That means the public invariant becomes:

> a conversation has one canonical durable run record and one canonical session file; any live worker is just the current executor for that durable state.

## What stays the same

Keep these parts from the earlier design:

- daemon remains the control plane
- session mutation stays single-owner at a time
- the browser still speaks web SSE + POST
- the current web event vocabulary remains the normalized stream model
- `sessionFile` stays the canonical durable transcript source
- `conversationId` remains the main public identifier

## What changes

### 1. Worker ownership is no longer the durable primitive

A worker process may die and later be recreated.

Durability belongs to persisted conversation state:

- transcript (`sessionFile`)
- current snapshot
- pending control actions
- event journal / sequence metadata
- recovery policy and run status

### 2. Recovery is from durable boundaries, not process continuity

We do **not** promise:

- exact mid-token continuation
- exact mid-tool-call continuation
- continuation of the same child process

We **do** promise:

- rebuild from persisted transcript + snapshot + queue state
- continue from the last safe turn/tool boundary
- resume pending prompt/steer/follow-up work with a fresh worker

### 3. Parent/child IPC should not be the durability foundation

Parent/child IPC may still be useful as a local implementation detail for a worker instance, but it should not be the architectural basis of restart recovery.

The durable basis should be the run store under daemon state.

## Proposed durable conversation state

Each live conversation should be represented as a durable run, probably with kind:

- `conversation`

Suggested per-conversation files under the run root:

- `manifest.json`
- `status.json`
- `checkpoint.json`
- `snapshot.json`
- `events.jsonl`
- `queue.json`
- `output.log`
- `result.json` when terminal

### `manifest.json`

Immutable identity and launch spec:

- `runId`
- `kind: conversation`
- `resumePolicy: continue`
- `conversationId`
- `sessionFile`
- `profile`
- `cwd`
- creation metadata

### `status.json`

Current lifecycle:

- `queued | running | recovering | waiting | completed | failed | cancelled | interrupted`
- active attempt
- timestamps
- last error
- current checkpoint key

### `snapshot.json`

Latest durable live view used for reconnect:

- `conversationId`
- `title`
- `isStreaming`
- `blocks`
- `queueState`
- `contextUsage`
- `stats`
- `lastSequence`
- `workerState`

### `queue.json`

Pending control actions not yet durably completed:

- prompt
- steer
- follow-up
- abort
- compact
- reload

### `events.jsonl`

Append-only event journal for recent replay and debugging.

## Recovery flow

On daemon startup or conversation attach:

1. load the durable conversation run
2. load `sessionFile`, `snapshot.json`, and `queue.json`
3. inspect status
4. if work was mid-flight, mark prior attempt interrupted/recovering
5. start a fresh worker
6. rebuild live runtime from transcript + snapshot
7. resume the pending queue from the last durable boundary

## Safe continuation model

For v1, safe continuation should happen only at durable boundaries.

Reasonable boundaries:

- after a committed user message
- after a committed assistant block batch / turn boundary
- after a committed tool result
- after a committed queue-state update

If interruption happens between boundaries, the new worker should re-drive from the last committed state.

## Tool behavior in conversations

Exactly-once tool execution is out of scope, so the minimum acceptable model is:

- persist tool start metadata
- persist tool completion metadata before committing the tool result into snapshot/transcript state
- on recovery, rerun only work whose result was not durably committed

This is acceptable for v1 and consistent with the broader run durability model.

## Attach / subscribe implications

The subscribe contract can remain snapshot-first.

On reconnect:

- daemon ensures a recoverable worker exists or creates one
- returns snapshot-first state
- then replays any available recent events
- then streams fresh events

The browser does not need to know whether the worker is the original one or a recovered one.

## Practical implication for implementation order

Conversation migration should happen **after** the generic durable runs substrate exists.

Why:

- conversation recovery needs the same manifest/status/checkpoint machinery
- scheduled tasks and conversation recovery should not invent two different durability models
- tmux removal becomes easier once both background jobs and conversations share the same substrate

## Recommended change to the earlier runtime design

Use the earlier document for:

- event vocabulary
- snapshot shape
- control API needs
- single-owner semantics
- web/gateway migration boundaries

But replace its durability foundation with:

- durable conversation run record
- persisted snapshot + queue + event journal
- fresh-worker recovery on restart

That is the version of the conversation architecture that matches the clarified restart requirement.
