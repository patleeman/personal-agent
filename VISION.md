# VISION

_Status: working draft_

_Last updated: 2026-03-10_

## Why this document exists

This file captures the long-term vision for `personal-agent` so product decisions, architecture, and feature priorities can be evaluated against a clear target state.

The goal is not to fully specify implementation now. The goal is to make the core product bets explicit so future work converges toward one coherent system.

## Current snapshot

Today, `personal-agent` is a personal application layer over Pi with:

- profile-based configuration and resources
- local runtime state
- a TUI launch path (`pa tui`)
- a daemon for background work and scheduled tasks
- Telegram gateway support
- deferred resume
- extensions, memory policy, and tmux tooling

## Product thesis

`personal-agent` should become Patrick's single personal agent system: a local-first, portable, profile-aware, conversation-first agent that carries forward durable memory, creates durable artifacts for ongoing work, and can act through whichever interface fits the moment.

A conversation is not the agent.
A surface is not the agent.
A single transcript is not the durable container of work.

The system should feel like one continuous agent across time, machines, and interfaces, while preserving the chat-thread UX that makes Pi useful in the first place.

The core idea is:

- **conversations are the primary interaction model**
- **artifacts are the durable handles for work**
- **workstreams are mostly internal structure that organize related artifacts**
- **surfaces are peer interfaces into the same agent**
- **autonomous work should surface through artifacts, activity, and optional notifications**

What Patrick should mostly care about is not managing internal containers. He should care about being able to:

- talk to the agent naturally
- continue the same conversation from TUI or gateway
- see the current plan and what matters now
- inspect what happened when needed
- pick work back up from any conversation or surface
- let the agent continue or check back later without blocking the main interaction loop
- avoid reloading full transcript context just to continue making progress

## North-star experience

When this vision is working well:

- a new conversation starts from durable memory and awareness of relevant ongoing work rather than from a blank slate
- Patrick can use Pi-style conversations normally, including rewinding and forking threads when useful
- a conversation can move between TUI and gateway without becoming a different conversation conceptually
- when a conversation turns into real work, the agent creates durable artifacts so the work survives compaction, time gaps, and surface changes
- plans, tasks, background runs, subagent outputs, verification results, and summaries are all inspectable without being forced into the foreground all the time
- Patrick can jump back into a piece of work and get a concise executive summary before reading raw transcripts
- long-running or delegated work can continue asynchronously while remaining visible and attributable
- deferred resume can unblock the current loop and bring the same conversation back later
- scheduled/background work can update artifacts and an activity stream even when no active TUI conversation exists
- gateway notifications are available when desired, but not the default outcome of every autonomous action
- the system reduces the cost of context switching between conversations
- the agent remains local-first, inspectable, and easy to override

## Working decisions

These are the strongest current bets.

### 1. This is intentionally a personal system

`personal-agent` is for Patrick only.

It is not a multi-tenant SaaS product, not a generalized consumer assistant, and not primarily an attempt to design a reusable platform for many users. Reusability is useful when it keeps the personal system clean and maintainable, but personal usefulness wins over abstract generality.

### 2. One agent should span many conversations and surfaces

The agent should feel like one continuous entity across:

- TUI
- Telegram
- background automation
- future app or web interfaces

Conversations are entry points into the agent, not the container of its identity.

### 3. Profiles are context boundaries

Profiles primarily represent domain/context, not UI surface.

Examples:

- personal
- work
- home
- research

The current expectation is that a machine usually has one dominant active profile, even if the system can technically support multiple profiles. The single agent should still have a shared core identity, with profile-specific memory, tools, behavior, and routing layered on top.

### 4. Conversations are the primary user experience

The default interaction model should remain the Pi chat-thread paradigm.

That means conversations should continue to support things like:

- normal back-and-forth chat
- asking questions
- brainstorming
- planning
- paired coding and debugging in the moment
- rewinding
- forking
- steering the agent interactively

Not every useful interaction should become a formal work object.

A lot of value should remain lightweight and conversational.

### 5. TUI and gateway are peer conversation surfaces

Gateway is not just a notification side-channel.

Current direction:

- TUI and gateway should be peer surfaces into the same agent
- gateway is often used for quick chats, updates, and on-the-go interaction
- gateway should still preserve the core conversation capabilities of the TUI
- a conversation should be able to move from TUI to gateway and back
- a conversation should also be able to notify Patrick later through gateway when appropriate

The surfaces may differ in ergonomics and presentation, but not in the underlying identity of the conversation.

Likely default TUI shell:

- **left sidebar** — inbox first, then conversations; conversations that need attention should bubble to the top
- **center panel** — the Pi conversation panel
- **right panel** — current objective/intent, summary, plan, activities, artifacts, and related workstreams

The inbox is best understood as a surfaced attention view over conversations and activity, not necessarily as a separate durable object in the core model.

This also gives scheduled/autonomous work a natural way to re-surface conversations: when background activity matters, it can bubble the related conversation into the inbox/sidebar rather than assuming an active TUI thread is already open.

### 6. Durable artifacts matter more than durable transcripts

When work needs to survive beyond the immediate conversation, the system should produce durable artifacts.

Examples include:

- plans
- task lists / jobs
- background work records
- subagent transcripts
- tool-call chains or summaries
- verification results
- executive summaries
- other files or reports created during the work

These artifacts matter more than preserving raw chat as the primary continuity mechanism.

Raw transcripts still matter for inspectability, but they should not be the only way to understand or resume work.

### 7. Workstreams are durable internal grouping, not the main UX

The system appears to need some internal container that groups related work over time. `workstream` is the current name for that concept.

A workstream should:

- group related artifacts
- let work span multiple conversations and surfaces
- let the agent keep track of what belongs together
- make it possible to resume work without depending on one transcript

But the workstream does **not** need to be a heavy user-facing concept.

Patrick does not need to manage workstreams directly the way a project-management tool would force him to. The main thing that matters is that the agent can keep artifacts together and expose them in one place when needed.

### 8. A plan is part of a workstream

A plan should be a durable summarized artifact that survives compaction and helps the agent keep track of the work.

The cleanest current model is that a workstream has a plan attached to it rather than treating plan as a completely separate top-level concept.

A plan should ideally have revision history. Plain text in git is attractive when practical.

### 9. Tasks/jobs are execution units inside a workstream

Tasks or jobs are useful, but they are not the whole system.

The common workflow looks more like:

**chat → create plan → break into tasks → complete tasks → verify work → complete**

So tasks live mainly in the execution phase of work. They are useful for:

- background execution
- daemon jobs
- subagents
- implementation steps
- verification runs
- scheduled checks and reports

A task-oriented system like Task Factory may still be useful, but it should not define the whole product model.

### 10. Deferred resume is a conversation-level continuity primitive

Deferred resume is not the same as scheduled autonomous work.

Its role is to let the agent unblock the current interaction loop and come back to the **same conversation** later.

Current direction:

- deferred resume is conversation-scoped
- it is useful for checking back later while the agent or Patrick does other things
- it should preserve conversational continuity rather than creating a separate work object by default
- it is a core tool for keeping the main agent loop unblocked

So deferred resume belongs to conversation continuity more than to task execution.

### 11. The daemon should be the primary background execution substrate

Background execution should primarily live in the daemon, not in tmux.

Current direction:

- scheduled tasks, deferred resumes, and future autonomous/background execution should be daemon-centered
- tmux may remain useful as optional tooling for interactive debugging, inspection, or manual workflows
- tmux should not be a core dependency of the product model for autonomy
- the durable record of background execution should come from daemon-managed artifacts, activity, and logs

### 12. Scheduled tasks are the main autonomy primitive

Scheduled tasks are the main mechanism for work that should happen independently over time.

They are useful for:

- recurring reports
- monitoring and checks
- reminders and follow-ups
- re-checking external state later
- autonomous background work that is not tied to an actively open conversation

The agent should be able to create scheduled tasks in multiple ways depending on context:

- explicitly because Patrick asked
- by proposal and approval
- automatically in obvious cases

The permission model should remain loose by default: ask mainly for destructive, risky, or hard-to-reverse actions.

### 13. Autonomous work should surface through activity first, notification second

A scheduled task or background run should not depend on an active conversation being open in the TUI.

That implies the system needs a first-class activity or inbox-like layer for surfacing autonomous output.

Current direction:

- autonomous work should update durable artifacts first
- by default, it should also create an activity/inbox entry that can be reviewed later
- gateway notification is optional routing on top, not the source of truth
- default behavior is closer to: update artifacts + activity entry
- optional behavior is: update artifacts + activity entry + send to Telegram
- activity that matters should be able to bubble a related conversation into the inbox/sidebar
- the inbox should surface both standalone activity and conversations needing attention

This makes activity a better default surfacing layer than forcing every result back into an active conversation.

### 14. The agent should create workstreams when durable structure is needed

A conversation can exist with no workstream at all.

When the agent needs durable organization for the work, it should be able to create a workstream intentionally. That creation unlocks the ability to:

- attach a plan
- create workstream todos
- collect artifacts in one place
- maintain an executive summary
- continue the work from another conversation or surface later

This may become a structural requirement for some actions. For example, background work or scheduled work may implicitly require a workstream so the resulting artifacts have a durable home.

### 15. Conversations can reference work without owning it

A conversation should not be the owner of durable work.

Current direction:

- a conversation may exist with no workstream
- a conversation may reference one or more workstreams
- a workstream may span multiple conversations and surfaces
- any conversation should be able to pick up related work
- a conversation can have one practical focus while still referring to others

Forking should behave carefully:

- if a conversation is forked, the fork may inherit references to related work
- but the fork should be free of firm attachment by default unless the user or agent intentionally reattaches it

### 16. Summaries should optimize context switching

One of the main product problems to solve is the cost of context switching between conversations.

The system should maintain concise, actionable summaries that compress ongoing work into the minimum needed to continue effectively.

Work summaries should prioritize from highest-attention to lowest-attention items.

Current priority order:

1. objective
2. current plan
3. current status
4. blockers
5. secondary: completed items, open tasks
6. tertiary: everything else

This summary layer should provide actionable intelligence without requiring Patrick to replay entire transcripts.

### 17. Inspectability is a product requirement

The system must make it easy to answer:

- what is the agent doing?
- why is it doing that?
- what happened already?
- what should happen next?

Noisy execution details such as subagent output or background work do not need to dominate the main conversation, but they must remain inspectable.

### 18. Prefer durable files over runtime-only state

Runtime should not be assumed durable.

The safest current assumption is:

- durable state should live in files
- prefer plain text in git when practical
- local runtime state may still exist, but should not be the only durable source of truth for important work artifacts

The exact split between markdown, structured metadata, and machine-local execution state is still open, but the direction is file-backed and local-first.

### 19. Work should fade, not require heavy curation

Patrick should not have to manually cull old workstreams.

A better model is more like a conversation list or stream of historical work:

- old work can fade in prominence over time
- attention can be derived from recency, blockers, open work, recent activity, or unresolved follow-up
- the system should avoid forcing explicit cleanup as routine maintenance

This argues against a heavy explicit workstream lifecycle or project-management-style state machine.

## Canonical internal model (working)

A likely core model is:

- **Agent** — the enduring personal entity
- **Profile** — a context boundary that shapes behavior, tools, memory, permissions, and routing
- **Surface** — TUI, Telegram, background daemon, future app/web UI
- **Conversation** — the primary interaction thread between Patrick and the agent on a given surface
- **Deferred Resume** — a scheduled continuation of a specific conversation
- **Workstream** — a mostly internal durable grouping for related artifacts and execution
- **Artifact** — a durable output or record of work, such as a plan, summary, task list, report, transcript, or verification result
- **Task/Job** — an execution unit inside a workstream
- **Execution** — a concrete run or attempt performed for a task/job or other structured action
- **Summary** — a compressed, attention-ordered view of ongoing work
- **Activity** — an autonomous update or item needing attention, independent of any currently active conversation
- **Memory** — durable knowledge and behavior resources
- **Notification** — an optional routed delivery of activity to the right surface

Likely relationships:

- one **agent** spans many **profiles** and **surfaces**
- a **profile** shapes what memory, tools, and policies apply
- a **conversation** may remain purely conversational or may lead the agent to create a **workstream**
- a **deferred resume** targets a specific **conversation**
- a **workstream** groups related **artifacts**, **todos**, **executions**, and **summaries**
- a **plan** is an artifact attached to a workstream
- a **conversation** can reference multiple **workstreams**
- a **workstream** can span multiple **conversations** and **surfaces**
- background or scheduled work may create **activity** even when no active conversation is open
- **notifications** should usually deliver or point to **activity**, rather than being the only durable record of autonomous work
- surfaces should likely expose an inbox view that combines **activity** and **conversations needing attention**
- forked conversations may inherit references to workstreams but should be detached by default unless intentionally reattached
- workstream importance should be derived from attention signals rather than requiring a heavy explicit state machine
- durable **memory** should be partially profile-scoped and partially part of a shared core identity

## Core product loops

The system seems to be converging around six loops.

### 1. Interactive conversation loop

Patrick asks for help in the moment.
The agent uses the active profile context and durable memory to respond effectively.
This loop may remain purely conversational.

### 2. Cross-surface conversation loop

A conversation starts in one surface and continues in another.
The surface changes, but the underlying conversation and agent continuity do not.
This is especially important between TUI and gateway.

### 3. Planning and execution loop

A conversation crystallizes into real work.
The agent creates a workstream when durable organization is useful.
A plan is attached.
Workstream todos may be created.
Artifacts accumulate.
Verification happens.
A summary captures what matters next.

### 4. Deferred-resume loop

The current interaction should pause without losing continuity.
The agent schedules a deferred resume for the same conversation.
Later, the conversation is resumed with the relevant context already in place.

### 5. Background automation loop

The agent performs scheduled or recurring work such as checks, summaries, alerts, or clawdbot-like reporting.
That work should land in durable artifacts and activity so it can be inspected and resumed from conversations later.

### 6. Memory curation loop

The agent promotes stable, useful knowledge from conversations and work artifacts into durable memory.
It also reviews, deduplicates, reorganizes, and refines stored memory so continuity improves rather than degrades over time.

## Design principles to pressure-test

- **Local-first by default** for data, runtime state, and development workflows
- **Personal before general** — optimize for Patrick's real life and real work
- **Conversation-first UX** — preserve the Pi thread model as the primary interaction paradigm
- **Peer surfaces** — TUI and gateway should be different interfaces to the same agent, not different classes of interaction
- **Artifacts over raw transcript reliance** — durable work should be recoverable from compact artifacts and summaries, not only from chat history
- **Workstreams as internal structure** — organize work durably without forcing project-management UX onto the user
- **Profiles as operating contexts** — domain/context should shape behavior more than UI surface does
- **Git-backed durable resources** with clear separation between committed resources and machine-local execution state
- **Portable by construction** — durable identity, memory, and work artifacts should move cleanly across machines
- **Multi-surface continuity** — the same agent should work coherently across TUI, Telegram, and background automation
- **Daemon-first background execution** — autonomous/background work should primarily be managed by the daemon, not depend on tmux as core infrastructure
- **Conversation continuity primitives** — deferred resume should make it easy to pause and re-enter the same conversational context later
- **Activity before notification** — autonomous work should have a durable surfacing layer even when no conversation is active
- **Inbox-first attention model** — the UI should bubble what needs attention instead of forcing Patrick to hunt across threads and artifacts
- **Reliable execution** — long-running and multi-step work should be observable, resumable, and robust
- **Inspectable by default** — all meaningful work should remain reviewable
- **Reduce context burden** — summaries should compress work into actionable intelligence
- **Safe autonomy** — initiative should increase usefulness without creating hidden or risky behavior

## Open questions still worth resolving

### 1. Core identity vs profile identity

Questions:

- What belongs in shared global identity versus profile-specific identity?
- How small should the truly global core be?
- Should some forms of memory always be profile-local unless explicitly promoted upward?

### 2. Memory write policy

Questions:

- What qualifies for promotion into durable memory?
- Which memory writes can happen automatically with high confidence?
- Which writes should usually be proposed for review?
- What cadence or triggers should drive cleanup, deduplication, and reorganization?

### 3. Artifact model

Questions:

- What artifact types should exist from the beginning?
- Which artifacts should be plain markdown/text files versus structured metadata files?
- What minimal schema should plans, summaries, todos, activity entries, and verification results share?
- How should noisy artifacts such as subagent transcripts and tool traces be summarized and referenced?

### 4. Workstream creation rules

Questions:

- Exactly when should the agent create a workstream?
- Which actions should implicitly require a workstream, such as background tasks or scheduled jobs?
- How explicit should workstream creation be in the UX, if the concept itself is mostly internal?
- Should every task/job belong to a workstream, or are there valid standalone cases?

### 5. Surface and gateway model

Questions:

- What are the true core features that must be shared across TUI and gateway?
- Which workflows should remain easier in TUI, even if gateway stays fully capable at the core level?
- How should cross-surface conversation continuation be represented and navigated?
- How should the inbox rank conversations needing attention versus standalone activity?
- Is the inbox purely a view over activity + conversations, or does it need any durable state of its own?
- Is there still a canonical surface that should receive the best UX first?

### 6. Activity and output routing model

Questions:

- What should the activity/inbox stream look like?
- Which autonomous outputs should create activity entries by default?
- How should activity relate to conversations, workstreams, and artifacts?
- When should activity also send a gateway notification?
- How should scheduled work surface back into a conversation when there is no active TUI session?

### 7. Deferred resume and autonomy boundaries

Questions:

- What actions should the agent take automatically when triggered by pre-set tasks?
- What actions should always require explicit confirmation?
- How aggressively should the agent create deferred resumes, scheduled tasks, or follow-ups on its own?
- What exact distinction should the product maintain between deferred resume and scheduled task behavior?

### 8. File and storage layout

Questions:

- What should live in git versus machine-local state?
- Where should workstream files, artifacts, and activity records live?
- How much structured metadata is needed alongside plain text documents?
- What indexing or lookup layer is needed so the agent can reliably find relevant work artifacts later?

### 9. Success criteria

In 12–24 months, what would make the answer be:

> “This is actually the system I wanted.”

Candidate dimensions:

- daily active usefulness across multiple life contexts
- personal knowledge continuity across conversations
- reduced cognitive overhead
- lower context-switching burden while multi-tasking
- fewer moments where Patrick has to manually perform or mediate digital tasks himself
- trustworthy automation
- strong inspectability into what the agent is doing and why
- research leverage
- coding acceleration

## Build priorities for the next iterations

A reasonable next design sequence is:

1. **Define the artifact model**
   - initial artifact types
   - shared schema/metadata conventions
   - summary structure
   - activity entry structure
   - inspectability vs noise management

2. **Define workstream creation and organization**
   - when the agent creates one
   - whether some actions require one
   - how artifacts attach to it
   - how it stays mostly internal in the UX

3. **Define the UI shell and surface continuity**
   - inbox-first left sidebar behavior
   - how conversations needing attention bubble to the top
   - center conversation model
   - right-side context stack
   - how conversations move between TUI and gateway
   - which core features must exist on both surfaces
   - how deferred resume re-enters the same conversation

4. **Define activity and notification routing**
   - when autonomous work creates activity entries
   - when activity also sends gateway notifications
   - how scheduled work surfaces without assuming an active conversation

5. **Define file-backed durability**
   - git-backed vs machine-local state
   - markdown vs metadata split
   - storage layout for plans, todos, summaries, activity, and execution artifacts

6. **Define architecture around the canonical model**
   - how agent/profile/conversation/deferred-resume/workstream/artifact/activity/execution concepts map onto implementation boundaries
   - which concepts deserve first-class storage and APIs versus remaining conventions

## Non-goals to clarify later

Potential non-goals and boundaries:

- multi-tenant SaaS product
- generalized consumer assistant for many users
- cloud-first hosted architecture
- polished consumer UI before core utility is strong
- broad app integrations with weak reliability
- human-impersonating autonomy without clear controls
- replacing Patrick's existing tools wholesale instead of acting through or alongside them
- turning the system into a project-management tool that requires manual bookkeeping

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
- Patrick strongly values the Pi chat-thread paradigm, including rewind and fork.
- Conversations are the main interaction model and should not all be forced into tasks.
- The common workflow is closer to: chat → create plan → break into tasks → complete tasks → verify → complete.
- Plans should be durable summarized artifacts that survive compaction and help track work over time.
- Some internal container is still needed to group plans, tasks, and related artifacts; `workstream` is the current term.
- A workstream should have a plan attached and may span multiple conversations and surfaces.
- Workstreams should mainly be internal organization for the agent, not a heavy user-facing concept to manage directly.
- Tasks/jobs are execution units inside a workstream and may be created automatically by the agent when needed.
- The agent should be able to create workstreams automatically when durable organization is needed, especially for background work, subagents, or other long-running execution.
- A conversation can reference multiple workstreams; any conversation can pick work up later.
- If a conversation is forked, the fork should inherit references to related work but be detached by default unless intentionally reattached.
- The user-facing priority is access to artifacts and concise executive summaries, not exposure to the underlying grouping model.
- Summary quality is critical for reducing context-switching burden; the summary should prioritize objective, current plan, status, and blockers first.
- Noisy execution details such as background work and subagent conversations can stay out of the main path as long as they remain inspectable.
- Durability should prefer files and plain text in git when practical; runtime should not be assumed durable.
- Old work should fade in importance over time rather than requiring active culling.
- Gateway should be a peer conversation surface, not merely a notification side-channel.
- TUI and gateway should share the core conversation features, even if they differ in ergonomics.
- Deferred resume is best understood as a conversation-level primitive for unblocking the current loop and checking back later.
- Scheduled tasks are the main autonomy primitive for work that should happen independently over time.
- The permission model should stay loose: the agent can act autonomously unless the action is destructive, risky, or hard to reverse.
- By default, autonomous work should update artifacts and create activity/inbox entries without necessarily sending notifications.
- Sending scheduled-task output to Telegram should be an option layered on top of the default artifact + activity behavior.
- The system likely needs a first-class activity or inbox stream so autonomous work can surface even when no active TUI conversation exists.
- The daemon should become the primary substrate for background/autonomous execution; tmux should be optional tooling rather than core product infrastructure.
- The default TUI shell should likely be inbox-first: left sidebar for inbox/conversations, center conversation panel, right context/artifact panel.
- Conversations needing attention should bubble to the top of the inbox/sidebar, including when scheduled or autonomous work triggers new activity.
- This revision expanded the vision beyond active work to cover interaction surfaces, conversation continuity, autonomy/output routing, and the default UI shell.
