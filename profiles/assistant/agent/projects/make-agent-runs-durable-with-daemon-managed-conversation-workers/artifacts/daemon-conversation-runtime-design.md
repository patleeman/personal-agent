# Daemon conversation runtime design

Date: 2026-03-12
Project: `make-agent-runs-durable-with-daemon-managed-conversation-workers`

## Problem

Today the live `AgentSession` owner lives inside the web server (`packages/web/server/liveSessions.ts`) or inside the gateway process (`PersistentConversationController` in `packages/gateway/src/index.ts`).

That creates three problems:

1. restarting the web server kills active web runs
2. the gateway and web cannot safely attach to the same live owner
3. reconnect logic is process-local instead of daemon-supervised

The durable runtime should move the live `AgentSession` owner into the daemon so UI and gateway processes become attachable clients.

## Goals

- active runs survive web server restarts
- one live owner exists per active session file
- multiple clients can attach to the same live conversation
- the browser continues to use web SSE + POST; the web server becomes a daemon client
- the session JSONL file remains the durable transcript source of truth
- current web live-session behavior stays recognizable to the UI
- the runtime shape is generic enough for later gateway migration

## Explicit non-goals for the first implementation

- surviving a **daemon** crash or daemon restart in the middle of a run
- supporting direct browser-to-daemon connections
- redesigning the Pi session JSONL format
- solving concurrent multi-profile isolation beyond carrying `profile` through the API
- changing Telegram-specific message-edit behavior during the first web migration

## Reuse from the current code

### Web live session registry

Keep the current web snapshot and event vocabulary as the canonical conversation event model:

- `snapshot`
- `agent_start`
- `agent_end`
- `turn_end`
- `user_message`
- `queue_state`
- `text_delta`
- `thinking_delta`
- `tool_start`
- `tool_update`
- `tool_end`
- `title_update`
- `context_usage`
- `stats_update`
- `error`

These are already what the browser consumes via `packages/web/src/hooks/useSessionStream.ts`.

### Gateway persistent controller

Reuse the gateway controller's handling for:

- prompt vs steer vs follow-up dispatch
- abort behavior
- streamed text accumulation
- tool activity tracking
- model switching per run

That logic should move behind worker commands instead of remaining gateway-local.

## Architecture decision

## 1. Main daemon stays the public control plane

`personal-agentd` keeps the public Unix socket and gains a conversations supervisor.

The supervisor is responsible for:

- tracking live conversation workers
- enforcing single-owner guarantees
- handling create/resume/attach commands
- multiplexing worker events to subscribers
- exposing conversation status to the web server and later the gateway

Clients do **not** talk directly to worker processes.

## 2. One worker process per live conversation

Each active conversation gets one worker child process.

The worker owns exactly one Pi `AgentSession` and is the only process allowed to mutate it.

The worker is responsible for:

- creating or resuming the session manager
- prompting / steering / follow-up / abort / compact / reload / fork operations
- producing the normalized event stream
- maintaining the current live snapshot
- patching immediate session-file persistence the same way the web registry does today

This preserves the core invariant:

> session mutation is single-owner, client attachment is multi-reader / multi-controller through the daemon

## 3. Use parent/child IPC between daemon and workers

Use Node child-process IPC between the daemon supervisor and each worker.

Why:

- no extra per-worker sockets to manage
- easy worker crash detection from the supervisor
- the daemon can translate worker messages into subscriber streams without exposing worker internals
- better fit than making every worker a second public server

## Runtime identity model

## Canonical live key

The canonical live-owner key is the normalized `sessionFile` path.

Reasons:

- it is durable across web-server restarts
- it is what both web and gateway already persist
- it prevents duplicate workers from being created for the same transcript

## Conversation id

Each worker also exposes a `conversationId`, which is the Pi session id read from the session file or from the freshly created session.

Use it as the main client-facing identifier because:

- current web APIs already route by session id
- the browser, session lists, and conversation pages already use it

So the supervisor stores both:

- primary dedupe key: `sessionFile`
- public id / alias: `conversationId`

## Supervisor state per live conversation

The supervisor keeps this in memory and writes a small inspect/debug status file under the daemon state root:

- `conversationId`
- `sessionFile`
- `profile`
- `cwd`
- `workerPid`
- `state`: `starting | idle | running | stopping | errored`
- `createdAt`
- `lastActivityAt`
- `lastSequence`
- `subscriberCount`
- `title`
- `isStreaming`
- last worker error / exit reason if present

The status file is for inspectability and stale-state cleanup, not for replaying in-flight runs after a daemon crash.

## Worker snapshot model

The worker owns the canonical live snapshot:

- `conversationId`
- `profile`
- `cwd`
- `sessionFile`
- `title`
- `isStreaming`
- `blocks` (`DisplayBlock[]`, matching the current web display model)
- `queueState` (`steering[]`, `followUp[]`)
- `contextUsage`
- `stats`
- `lastSequence`
- `workerState`

This snapshot is what reconnecting clients use after a web restart.

## Event sequencing and reconnect model

## Sequence numbers

Every worker event that can affect client state gets a monotonically increasing `sequence` number.

Sequence numbers are scoped per conversation worker.

## Event envelope

The daemon should stream envelopes of the form:

```ts
interface ConversationEventEnvelope {
  conversationId: string;
  sequence: number;
  emittedAt: string;
  event: SseEvent;
}
```

The inner `event` payload should stay compatible with the current web SSE event union.

## Replay buffer

Each worker keeps a bounded in-memory replay buffer of recent event envelopes.

That buffer is used for reconnects and gateway follow-up migration later.

The replay buffer does **not** replace the session file. It only covers recent live deltas since the latest stable snapshot.

## Subscribe behavior

The daemon conversations subscribe API should support:

- `conversationId`
- optional `afterSequence`
- optional `includeSnapshot`

Behavior:

1. `includeSnapshot: true` → return the full current snapshot first, then stream live events
2. `afterSequence` within buffer → replay missed events greater than `afterSequence`, then stream live events
3. `afterSequence` too old / unavailable → send a fresh snapshot and continue from there

That gives the web server a simple rule:

- on every browser SSE connection, ask for `includeSnapshot: true`

and gives later gateway reconnection logic a more precise rule:

- if it has the last seen sequence, ask for replay first

## Why snapshot-first is the default

The browser already knows how to rebuild its visible state from `snapshot` plus deltas.

So the reconnect contract should optimize for correctness and simplicity:

- a web restart asks the daemon for the current snapshot
- the daemon attaches to the existing worker
- the browser gets a clean view of the in-flight conversation without depending on the dead web process

## Lifecycle rules

## Create

`conversations.create` creates a new session file, starts a worker, and returns the initial snapshot.

## Resume

`conversations.resume` takes `profile`, `cwd`, and `sessionFile`.

If a live worker for that `sessionFile` already exists, it returns that worker's snapshot.

If not, it starts a worker around the existing session file and returns the snapshot.

## Attach

`conversations.attach` attaches only to an already-live worker by `conversationId`.

This is the cheap path when the web server already knows the worker is alive.

## Destroy

`conversations.destroy` stops the worker and removes its live registry entry.

The session file remains.

For v1, keep the current explicit-destroy behavior and do **not** add automatic idle reaping yet.

## Worker exit

If a worker exits unexpectedly:

- the supervisor removes it from the live registry
- subscribers receive an error/lifecycle event
- future callers can `resume` from the same `sessionFile`

## Single-owner guarantees

The supervisor must dedupe concurrent create/resume requests.

Implementation rule:

- keep a singleflight `Promise` per normalized `sessionFile`
- if a second request arrives while the worker is starting, await the same promise
- once started, all attaches point at that same worker

That is the main guard against duplicate live owners.

## Initial daemon API surface

The daemon should add a `conversations.*` namespace.

### Needed for the web migration

- `conversations.list`
- `conversations.create`
- `conversations.resume`
- `conversations.attach`
- `conversations.subscribe`
- `conversations.prompt`
- `conversations.custom_message`
- `conversations.abort`
- `conversations.compact`
- `conversations.reload`
- `conversations.rename`
- `conversations.destroy`
- `conversations.fork_entries`
- `conversations.fork`
- `conversations.stats`
- `conversations.context_usage`

### Request shape notes

`conversations.create` and `conversations.resume` should carry `profile` explicitly, even though the first implementation will usually have one dominant active profile.

`conversations.prompt` should support the current web behaviors:

- normal prompt
- `steer`
- `followUp`
- optional image attachments

`conversations.custom_message` exists so the web server can keep injecting referenced project / task / memory context exactly the way it does today before prompting.

## Web migration boundary

The browser-facing web API should stay effectively unchanged:

- `/api/live-sessions`
- `/api/live-sessions/:id`
- `/api/live-sessions/:id/events`
- `/api/live-sessions/:id/prompt`
- other live-session control routes

The web server becomes a translation layer:

- browser speaks HTTP + SSE to the web server
- web server speaks daemon IPC to `personal-agentd`
- the daemon owns the live `AgentSession`

That keeps the React client mostly unchanged.

## Gateway migration decision

Decision: **do not migrate the gateway in the first implementation phase**.

Instead:

1. design the daemon API to support gateway needs now
2. migrate the web live-session routes first
3. once the web path is stable, replace `PersistentConversationController` with a daemon-backed controller

Reasoning:

- the web migration is the shortest path to the core durability goal: runs survive UI restarts
- the gateway has extra Telegram-specific streaming/edit concerns that should not block the supervisor/worker foundation
- if the daemon API already supports prompt, steer, follow-up, abort, and subscribe/replay, the gateway migration becomes a thinner follow-up

## Shared-type extraction needed before implementation

Before building the worker, extract the canonical live-conversation types out of `packages/web/server/liveSessions.ts` into a shared module that both web and daemon can use.

At minimum, share:

- `SseEvent`
- `LiveContextUsage`
- `PromptImageAttachment`
- snapshot-building helpers / normalized display-block contracts where practical

That avoids cloning the current live event model in two places.

## First implementation sequence

1. extract shared live conversation event/types from the web registry
2. add daemon IPC request/response types and client helpers for `conversations.*`
3. add the daemon conversations supervisor module
4. add the worker child-process entrypoint
5. migrate web live-session routes to the daemon client while keeping browser APIs stable
6. add tests for web restart + reattach + snapshot rebuild
7. migrate the gateway controller to the daemon runtime as a follow-up phase

## Resulting project-state decisions

This design settles the refine-plan milestone decisions:

- daemon supervisor + per-conversation child worker is the runtime model
- `sessionFile` is the single-owner dedupe key
- `conversationId` remains the public session identifier
- snapshot-first reconnect is the default contract
- bounded event replay exists for precise reconnects and later gateway migration
- web migrates first; gateway follows once the shared runtime is stable
