# VISION

_Status: draft_

_Last updated: 2026-03-10_

## Why this document exists

This file captures the long-term vision for `personal-agent` so product decisions, architecture, and feature priorities can be evaluated against a clear end state.

## Current snapshot

Today, `personal-agent` is a personal application layer over Pi with:

- profile-based configuration and resources
- local runtime state
- a TUI launch path (`pa tui`)
- a daemon for background work and scheduled tasks
- Telegram gateway support
- extensions, memory policy, and tmux orchestration

## Draft vision statement

`personal-agent` should become Patrick's single personal agent entity: a local-first, portable system that carries forward durable memory across conversations, helps across all contexts of life, acts through multiple interfaces depending on context, and performs delegated work when asked or when triggered by pre-set tasks.

## Design principles to pressure-test

- **Local-first by default** for data, runtime state, and development workflows
- **Personal before general** — optimize for Patrick's real life and real work; this is intentionally for Patrick only
- **One agent, many conversations** — each new conversation should begin from the agent's durable memory state, not from a blank slate
- **Git-backed configuration** with clear separation between committed resources and machine-local state
- **Portable by construction** — the agent's identity, memory model, and task model should move cleanly across machines and interfaces
- **Multi-surface UX** — the same agent should work coherently across TUI, Telegram, and background automation
- **Composable capabilities** through profiles, skills, memory, extensions, and scheduled tasks
- **Reliable execution** — long-running or multi-step work should be observable, resumable, and robust
- **Inspectable by default** — everything the agent does should be visible, reviewable, and legible
- **Reduce context burden** — active work should be compressed into summaries, durable facts, state views, and next actions so Patrick can multitask without reloading full transcript context
- **Safe autonomy** — agent initiative should increase usefulness without creating hidden or risky behavior

## Questions to answer

### 1. Product identity

Current direction:
- `personal-agent` is for Patrick only
- it should remain intentionally single-user and personal
- any generality or reuse is secondary to making it deeply useful in Patrick's actual life

Open follow-up:
- How much internal architecture should still be designed as reusable building blocks versus purpose-built personal infrastructure?
- What belongs in global core identity versus profile-specific identity?

### 2. Core jobs to be done

Current direction:
- help across all contexts of Patrick's life rather than one narrow domain
- behave as one continuous agent entity even when work is split across multiple conversations and surfaces
- begin each new conversation from durable memory state

Current priority workflows:
- **Coding** — the number one workflow
- **Personal assistant tasks** — general personal delegation and life-admin help
- **Monitoring and reports** — recurring status checks, summaries, and clawdbot-like reporting

Secondary candidate areas:
- research and synthesis
- life logistics
- inbox/calendar/task triage
- proactive monitoring and follow-up
- autonomous background execution

### 3. Profile model

Current direction:
- profiles primarily represent **domain/context**
- examples may include personal, work, home, research, or other context-driven operating spaces
- the single agent should be usable across profiles, but profile context should shape memory, tools, behavior, and task routing
- the agent should have a shared global core identity, with profile-specific identity appended on top
- in practice, profiles will usually be set per machine rather than switched frequently during use

Implication:
- the profile is becoming a major organizational boundary in the system
- profile choice may behave more like machine/environment configuration than an in-conversation mode toggle

Open follow-up:
- What belongs in global core identity versus profile-specific identity?
- Should a machine ever host multiple active profiles, or is one machine → one dominant profile the intended norm?

### 4. Primary interface model

Current direction:
- there may not be a single universal home interface
- personal-assistant use cases may fit Telegram or a dedicated app
- work use cases may fit TUI or a web app
- home coding on macOS may reasonably use either

Implication:
- interface should be context-sensitive, while the underlying agent identity and memory remain unified
- the way Patrick converses with the agent should stay flexible across surfaces

Open follow-up:
- Is there still a canonical surface that should receive the best experience first, even if others remain important?

### 5. Memory model

Current direction:
- durable memory is profile-dependent
- memory should be grounded in profile resources such as `AGENTS.md`, skills, and memory files
- useful information should be extracted from conversations into durable memory rather than leaving continuity trapped inside chat history
- memory extraction should be tightly curated, not indiscriminate
- the system should regularly review, deduplicate, reorganize, and refine stored memory so it remains useful over time

Open follow-up:
- What should qualify for extraction into durable memory versus remaining conversation-local?
- Should memory writes happen automatically for high-confidence items, or should they usually be proposed/reviewed first?
- What review cadence or triggers should drive memory cleanup and reorganization?

### 6. Task model

Current direction:
- tasks should be detached from any single interface
- tasks should be profile-scoped
- a task can be started in one place, run somewhere else, and be resumed or checked from another place
- example: start in TUI, continue or check status from Telegram
- some work may remain TUI-only, especially work-focused flows
- scheduled/background tasks should run on their own and notify Patrick through an appropriate surface such as Telegram, TUI, or a future app
- tasks should likely have stable IDs, cross-surface status, a transcript or activity history, artifacts, and an explicit notion of where to resume or notify
- prior work in `workingdir/task-factory` explored parts of this model, but not with the right abstraction yet

Implication:
- conversations are interfaces into work, but tasks are first-class objects with their own lifecycle
- the profile becomes part of the task's identity, permissions, memory context, and routing behavior
- each task likely needs both a full transcript/activity log and a compact task summary that exposes durable facts, progress, blockers, decisions, artifacts, and next actions

Open follow-up:
- What should the task lifecycle look like: queued, running, blocked, awaiting input, completed, failed?
- What is the right abstraction for task state, artifacts, and resumability?
- Can tasks move between profiles, or should they always remain inside the profile where they were created?

### 7. Internal model

Current direction:
- the system should have a canonical internal representation even if conversation surfaces differ
- likely first-class concepts include: agent, profile, memory, conversation, task, execution context, and surface
- conversations are flexible entry points; they are not the sole container of identity or continuity

Implication:
- interface flexibility should sit on top of a stable core model rather than redefining behavior separately per surface

Open follow-up:
- What exact objects and relationships should define the core architecture?
- Which parts of that model must be portable and syncable across machines?

### 8. Inspectability and context reduction

Current direction:
- everything the agent does should be inspectable and present
- Patrick should be able to see the underlying conversation or execution trail when needed
- at the same time, the system should reduce contextual burden by presenting the important facts of a task separately from the raw transcript
- a useful model is: full conversation/execution remains available, while a side summary captures the durable facts of what the agent is doing
- this summary layer helps Patrick multi-task without having to reload the whole working context every time

Implication:
- inspectability is not just a debugging feature; it is a core UX requirement for delegation and trust
- transcript and summary are different but linked representations of the same work

Open follow-up:
- What fields should always appear in a task summary view?
- How often should summaries refresh: every turn, every milestone, or on demand?
- Which summary facts should stay task-local versus being promoted into durable memory?

### 9. Autonomy boundaries

Current direction:
- primarily a tool Patrick drives directly
- proactiveness should come mainly from pre-set tasks, scheduled automations, and explicit standing instructions

Questions to refine:
- What actions should it take automatically when triggered by a pre-set task?
- What actions should always require confirmation?
- What kinds of memory should it maintain durably?

### 10. Success criteria

In 12–24 months, what would make you say:

> “This is actually the system I wanted.”

Possible dimensions:
- daily active usefulness across multiple life contexts
- personal knowledge continuity across conversations
- reduced cognitive overhead
- lower context-switching burden while multi-tasking
- fewer moments where Patrick has to manually perform or mediate digital tasks himself
- trustworthy automation
- strong inspectability into what the agent is doing and why
- research leverage
- coding acceleration

## Portability and sync

Current direction:
- portability primarily means portability across machines
- the implementation can evolve beyond a single repository as long as Patrick can bring the agent with him across environments
- some durable resources should be syncable across machines, especially memory, skills, and `AGENTS.md`
- portable use across profiles matters, not just portable execution on one host
- syncing durable memory/configuration is more important than syncing full raw conversation history
- task metadata and state may need to sync, but raw chats may not be the primary portability artifact

Open follow-up:
- Which resources must always sync across machines, and which should remain machine-local?
- How much task state should sync across machines: metadata only, status plus artifacts, or full execution history?
- What is the desired source of truth for portable state: git, a local database plus sync, or a hybrid?

## Non-goals to clarify later

Potential non-goals and boundaries:

- multi-tenant SaaS product
- generalized consumer assistant for many users
- cloud-first hosted architecture
- polished consumer UI before core utility is strong
- broad app integrations with weak reliability
- human-impersonating autonomy without clear controls
- replacing Patrick's existing tools wholesale instead of acting through or alongside them

## Conversation notes

### 2026-03-10

- Initial draft created from current repo state and open questions.
- Patrick wants `personal-agent` to be for him only, not a general multi-user product.
- The core concept is one agent entity across multiple conversations; each new conversation should start from durable memory state.
- It should help across all contexts of life rather than one narrow domain.
- Interface should vary by context: personal assistant use may fit Telegram or an app; work may fit TUI or web; home coding on macOS may use either.
- Autonomy should stay tool-like by default; proactiveness should mainly come from pre-set tasks.
- The goal is not to replace existing tools wholesale, but to reduce how often Patrick has to personally do the work or mediate interactions himself.
- Profiles primarily represent domain/context rather than device or UI surface.
- The agent should have a global core identity, with profile-specific identity appended on top.
- In practice, profiles will usually be set per machine rather than switched frequently.
- Durable memory should be profile-dependent and grounded in `AGENTS.md`, skills, and memory files, with useful information extracted from conversations.
- Memory curation should be tight and ongoing, with agent-driven review to deduplicate and reorganize information over time.
- Tasks should be detached from interfaces, but profile-scoped: start in one surface, run elsewhere, and be resumed or checked from another surface.
- Tasks likely need stable IDs, status views, resume points, and notification routing across surfaces.
- Inspectability is a core requirement: Patrick should be able to see what the agent is doing, including the underlying conversation or execution trail.
- The system should reduce multi-tasking context burden by presenting a compact side summary of durable task facts separate from the full transcript.
- Scheduled/background tasks should run independently and notify Patrick through Telegram, TUI, or a future app.
- The top priority workflows are coding, personal assistant tasks, and monitoring/reporting.
- Portability primarily means moving the agent cleanly across machines.
- Certain durable resources should sync across machines, especially memory, skills, and `AGENTS.md`.
- Durable memory/configuration matter more for sync than raw conversation history.
- Next step: refine core-vs-profile identity boundaries, memory extraction/review rules, task lifecycle/state model, summary/presentation model, sync boundaries, and internal architecture concepts.
