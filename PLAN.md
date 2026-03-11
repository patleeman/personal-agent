# PLAN

_Status: active_

_Last updated: 2026-03-10_

## Purpose

This is the **single active implementation plan** for `personal-agent`.

Use `VISION.md` for long-term product direction.
Use this file for the current execution sequence.
Do not create more planning docs unless a future implementation step truly needs a narrowly scoped spec.

## Goal

Implement the conversation-first, artifact-centric model from `VISION.md` in small, durable slices without turning `personal-agent` into a project-management tool.

## Working constraints

- Conversations remain the main UX.
- TUI and gateway are peer surfaces.
- The default UI should be inbox-first: left sidebar for inbox/conversations, center conversation panel, right context/artifact panel.
- Workstreams are mostly internal structure.
- Durable continuity should come from artifacts, summaries, activity, and conversation continuity primitives.
- The daemon should be the primary background execution substrate.
- Tmux should be optional tooling, not a core dependency of autonomy.
- Prefer plain text in git when practical.
- Do not assume runtime state is durable.
- Avoid heavy state machines and manual bookkeeping.
- Ask for confirmation mainly on destructive, risky, or hard-to-reverse actions.

## Current status

### Done

- [x] Align the product vision around conversations, artifacts, workstreams, gateway, deferred resume, and autonomous activity.
- [x] Add initial file-backed workstream scaffolding in `@personal-agent/core`.
- [x] Create profile-scoped workstream path helpers and tests.
- [x] Define initial summary/plan artifact conventions.
- [x] Add typed core read/write helpers for summary and plan artifacts.
- [x] Refactor scaffold generation to use typed artifact helpers.
- [x] Add round-trip artifact parsing/writing tests.
- [x] Define initial task/job record artifact conventions.
- [x] Integrate daemon task runs with durable activity output.
- [x] Build the first substantial web surface in `packages/web` with inbox, conversations, workstreams, tasks, memory, live Pi sessions, fork, and context rail.
- [x] Prove the inbox-first shell on both surfaces: lightweight TUI extension shell plus richer web implementation.

### Not done yet

- [x] Finish the broader artifact model for workstream todos at an initial file-backed level.
- [x] Define activity/inbox records at an initial file-backed level.
- [x] Define how deferred resume emits durable activity without turning into a scheduled task.
- [x] Add persistent conversation ↔ workstream references so conversations can pick up prior work across surfaces.
- [ ] Add derived attention/inbox ranking that can bubble related conversations based on activity.
- [ ] Integrate gateway output more fully with the new model.
- [x] Restore clean web install/build verification and keep browser-driven verification in the normal dev loop.
- [x] Add an explicit web profile switcher so active-profile mismatches are visible and correctable in-app.

## Reality check

The branch has already moved past a TUI-only shell. The fast-moving implementation surface is now the web app in `packages/web`, while the TUI inbox shell remains a lighter proof of the same model.

So the active execution focus is no longer “invent the first shell.” It is:

- tighten the continuity model underneath the shell
- connect deferred resume, activity, and conversations cleanly
- add durable conversation ↔ workstream links
- preserve the web shell as the main implementation surface without drifting away from the canonical model

## Current on-disk foundation

```text
profiles/<profile>/agent/workstreams/<workstream-id>/
  summary.md
  plan.md
  todos/
  artifacts/
```

Current intent:

- `summary.md` = executive summary / context-switching entrypoint
- `plan.md` = current plan artifact
- `todos/` = focused execution-unit records
- `artifacts/` = other durable outputs

## Implementation sequence

### Phase 0 — Workstream scaffold

_Status: done_

Deliverables completed:

- workstream id validation
- profile-scoped workstream path resolution
- scaffold creation for `summary.md`, `plan.md`, `todos/`, `artifacts/`
- tests and build verification

### Phase 1 — Artifact model

_Status: done_

Goal:

Define the first durable artifact shapes so the rest of the system has something concrete to read and write.

Deliverables:

- [x] define minimal frontmatter/content conventions for:
  - [x] `summary.md`
  - [x] `plan.md`
  - [x] activity entries
  - [x] workstream todos
- [x] add typed read/write helpers in core for summary and plan artifacts
- [x] make scaffold generation use the typed helpers instead of inline string formatting
- [x] add tests for round-trip parsing and writing

Acceptance criteria:

- [x] the repo has one obvious way to read and write summary/plan/activity/todo artifacts
- [x] artifact files remain plain text and git-friendly
- [x] the minimum schema is small and easy to evolve

### Phase 2 — Activity / inbox model

_Status: in progress_

Goal:

Create a durable surfacing layer for autonomous output that does not depend on an active conversation.

Deliverables:

- [x] define an activity entry format
- [x] choose a file-backed storage layout for activity
- [x] add core helpers to create/list/read activity entries
- [x] connect daemon task results to create activity entries by default
- [x] define minimal fields such as:
  - id
  - createdAt
  - profile
  - kind
  - summary
  - related workstream ids
  - related conversation ids
  - notification state

Acceptance criteria:

- [x] autonomous work can create durable activity without assuming an open TUI session
- [x] activity can be inspected independently of gateway notifications

### Phase 3 — UI shell and conversation continuity

_Status: in progress_

Goal:

Define the default UI shell and how conversations re-enter prior context across surfaces and over time.

Deliverables:

- [x] define the left sidebar model:
  - [x] inbox first
  - [x] conversations ordered by attention
  - [x] conversations needing attention bubbled to the top
- [x] define the center panel as the primary Pi conversation panel
- [x] define the first usable right-panel approximation for:
  - [x] objective/intent
  - [x] summary
  - [x] plan
  - [x] activities
  - [x] artifacts
  - [x] related workstreams
- [x] ship a first usable web shell implementing that model in `packages/web`
  - [x] inbox page
  - [x] live/historical conversations
  - [x] workstreams page
  - [x] tasks page
  - [x] memory browser
  - [x] live Pi session create/resume/stream/fork
- define the distinction between:
  - normal conversation continuation
  - deferred resume
  - activity surfacing
- [x] define and implement how a conversation references workstreams at an initial durable file-backed level
- define how background activity can bubble a related conversation into the inbox/sidebar
- define how a conversation can move between TUI and gateway while staying conceptually the same conversation
- add any minimal identifiers or metadata needed for cross-surface continuation
- add browser-driven verification for core shell flows so the web app does not drift from working behavior

Acceptance criteria:

- deferred resume is clearly modeled as conversation-level continuity
- conversations can pick up relevant work without owning it
- related activity can influence conversation attention ordering
- [x] the default UI shell is clear enough to guide implementation without inventing a project-management UI
- [x] the TUI has a usable first-shell implementation via inbox/context widgets plus an overlay side panel
- [x] the web app is a real implementation surface rather than a mock-only demo shell

### Phase 4 — Daemon-first scheduled task and autonomy integration

_Status: planned_

Goal:

Make scheduled/background work land in the new durable model with the daemon as the primary execution substrate.

Deliverables:

- decide whether all scheduled tasks require a workstream or can create one implicitly
- connect scheduled task results to:
  - artifacts
  - activity entries
  - optional notification routing
- define how subagent/background runs should emit durable records through the daemon
- remove tmux assumptions from core background execution paths
- preserve the loose permission model while keeping inspectability high

Acceptance criteria:

- scheduled work defaults to artifact + activity output
- Telegram delivery remains optional routing on top
- autonomous output is inspectable even with no active conversation

### Phase 5 — Gateway and surface integration

_Status: planned_

Goal:

Make the surface model real without splitting the product into different classes of agent.

Deliverables:

- define which core conversation features must exist on gateway as well as TUI
- define how activity and summaries are surfaced in gateway
- define how conversation identity and work pickup behave across TUI and gateway
- ensure gateway is a peer surface, not just a notification sink

Acceptance criteria:

- the model supports real TUI ↔ gateway conversation continuity
- gateway can inspect and continue core agent workflows while on the go

### Phase 6 — Retrieval, indexing, and hardening

_Status: planned_

Goal:

Make the system good at finding the right artifacts and reduce friction in daily use.

Deliverables:

- define lightweight indexing/lookup for workstreams and activity
- add retrieval helpers for “what matters now?”
- improve summary refresh/update mechanics
- harden file formats, tests, and failure handling

Acceptance criteria:

- the agent can reliably find relevant work artifacts later
- context switching cost is materially reduced

## Immediate next actions

1. Turn the conversation right rail into focused workstream context: summary, plan, todos, activity, and artifacts.
2. Remove transcript-like `Recent Messages` from the rail and let the conversation pane / future scrollbar design own transcript navigation.
3. Add the first derived attention/inbox ranking rules using activity + conversation linkage.
4. Integrate gateway output more intentionally on top of the artifact + activity path.
5. Keep browser-driven verification in the normal loop as shell behavior evolves.

## Explicitly out of scope for now

- no heavy workstream lifecycle/state machine
- no project-management-style manual curation flow
- no large UI redesign before the artifact and activity models are solid
- no cloud-first durability assumptions
- no proliferation of plan/spec docs unless needed later
