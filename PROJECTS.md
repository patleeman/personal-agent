# PROJECTS

_Status: active draft_

_Last updated: 2026-03-10_

## Purpose

This document replaces the earlier `workstream` direction with a clearer **project-centered** model for durable work in `personal-agent`.

Use `VISION.md` for product direction.
Use this document for the specific structure we want to implement for long-lived work, plans, tasks, summaries, and UI exposure.

## Why `workstream` is the wrong model

`workstream` is too vague and too internal.

What we actually want is closer to the model that was emerging in Task Factory:

- a **project** is the durable container for a body of work
- a project has a **high-level plan**
- a project contains **tasks** broken down from that plan
- tasks can be planned, executed, blocked, completed, and summarized
- both the project and its tasks should be **fully visible, inspectable, and editable** in the UI

The key idea is:

- **conversation** remains the primary interaction model
- **project** is the durable unit of organized work
- **task** is the durable execution unit inside a project
- **activity** is the attention/inbox surfacing layer
- **artifacts** are the durable outputs and evidence of work

This is more concrete, more inspectable, and more aligned with how Patrick actually thinks about structured multi-step work.

## Canonical model

### 1. Conversation

A conversation is a chat thread on a surface such as:

- web UI
- Telegram
- TUI
- future app surfaces

A conversation may:

- stay purely conversational
- create a project
- reference one or more existing projects
- continue work already represented in a project

A conversation is **not** the durable owner of the work.

### 2. Project

A project is the primary durable, user-visible container for organized work.

A project should:

- have a high-level objective
- have a current plan
- contain tasks
- accumulate artifacts
- expose current status and blockers
- link to related conversations
- be inspectable and editable from the UI

A project is **not** just an internal grouping concept. It should be first-class in both the data model and the interface.

### 3. Plan

Each project has a durable high-level plan.

The plan should:

- summarize the intended outcome
- break the work into major steps
- survive compaction and surface changes
- be editable by Patrick
- be inspectable separately from raw conversations

### 4. Task

A task is a durable execution unit inside a project.

Tasks are how the project gets executed.

A task should include:

- title
- objective
- status
- acceptance criteria
- dependencies
- notes / execution context
- related conversations when relevant
- references to artifacts when relevant

Tasks should feel closer to the Task Factory model than the old workstream/todo idea.

### 5. Task completion summary

Completed tasks should have a durable completion summary.

This is required for quick reference and context switching.

A task completion summary should answer:

- what was accomplished?
- were the acceptance criteria met?
- what evidence supports that?
- what files/artifacts matter?
- what follow-up work remains?

This summary should be easy to scan and should not require reopening the whole transcript.

### 6. Artifact

Artifacts are durable outputs such as:

- plans
- task summaries
- reports
- screenshots
- logs
- generated files
- verification outputs
- subagent transcripts or summarized execution records

Artifacts belong either to the project as a whole or to a task inside the project.

### 7. Activity

Activity is the inbox/attention layer.

It should surface:

- project changes that matter
- task completions or failures
- blocked work
- autonomous/background work updates
- notifications that need attention

Activity is how work re-surfaces, not the source of truth itself.

### 8. Deferred resume

Deferred resume stays a **conversation-level continuity primitive**.

It should not be collapsed into project or task scheduling.

A deferred resume may refer to project/task context, but its identity is still “resume this conversation later.”

## On-disk model

Primary durable layout:

```text
profiles/<profile>/agent/projects/<project-id>/
  project.md
  plan.md
  tasks/
    <task-id>.md
    <task-id>.summary.md
  artifacts/
```

### `project.md`

High-level project overview.

Suggested contents:

- title
- status
- objective
- current status
- blockers
- next actions
- linked conversation ids

### `plan.md`

High-level project plan.

Suggested contents:

- objective
- ordered major steps
- optional notes / assumptions

### `tasks/<task-id>.md`

Task definition and current execution state.

Suggested contents:

- title
- status
- objective
- acceptance criteria
- dependencies
- notes
- linked conversation ids

### `tasks/<task-id>.summary.md`

Task completion summary or current execution summary.

Suggested contents:

- outcome
- summary
- criteria validation
- key changes
- artifacts
- follow-ups

### `artifacts/`

Durable project outputs.

This can later expand into subfolders, including task-specific artifacts if needed.

## UI model

Projects should be fully exposed to the user.

### Top-level UI requirements

The UI should have a first-class **Projects** area.

A project should be:

- visible in the main navigation
- inspectable in detail
- editable inline where practical
- viewable in raw file form when needed

### Project list

The project list should surface:

- title
- status
- concise summary
- blocker state
- last updated time
- task counts / completion hints

### Project detail view

A project detail view should include:

- **Overview** (`project.md`)
- **Plan** (`plan.md`)
- **Tasks** (list + detail)
- **Task summaries** for completed work
- **Artifacts**
- **Activity** related to the project
- **Linked conversations**

### Editability

Projects and tasks should be editable in the UI.

That includes at minimum:

- project title/objective/status
- plan steps
- task title/status/objective
- task acceptance criteria
- task notes
- task summary content

### Inspectability

The UI should also make the underlying durable files legible.

Patrick should be able to:

- inspect the rendered view
- inspect the raw markdown/file representation
- understand what the agent changed and why

## Status model

### Project status

Initial project statuses:

- `active`
- `blocked`
- `completed`
- `on-hold`
- `cancelled`

### Task status

Initial task statuses:

- `backlog`
- `ready`
- `running`
- `blocked`
- `done`
- `cancelled`

We should avoid a heavy workflow engine unless it proves necessary, but task status does need to be explicit enough to support execution and review.

## Relationship to conversations

A conversation may reference one or more projects.

Rules:

- a conversation can exist with no project
- a conversation can create a project when work becomes durable
- a conversation can reference multiple projects
- a project can be continued from multiple conversations and surfaces
- forking a conversation should not implicitly fork or duplicate the project

Projects are durable work containers; conversations are interaction threads.

## Relationship to scheduled/background work

Scheduled or daemon-managed work should usually land on:

- a project
- optionally a specific task within that project
- and an activity entry for attention routing

Default direction:

- background execution writes artifacts
- updates a project/task
- emits activity
- optionally notifies through Telegram or another surface

## Relationship to Task Factory

This model intentionally borrows the useful parts of Task Factory without turning `personal-agent` into a queue-first task board.

Borrowed concepts:

- project-level durable planning
- task-level execution units
- explicit task status
- completion summaries for quick reference
- inspectable durable files

Not borrowed wholesale:

- task board as the primary UX
- forcing every interaction into the task model
- making the queue the top-level product identity

`personal-agent` remains **conversation-first**.

## Implementation plan

### Phase 1 — Project foundations

Goal:

Replace the core durable `workstream` scaffold direction with a `project` scaffold.

Deliverables:

- add core project path helpers
- add typed project, plan, task, and task-summary artifact helpers
- add tests for parsing/writing/scaffold creation
- add a `projects/` durable layout under profile resources

Acceptance criteria:

- the repo has one clear durable file layout for projects
- tasks are modeled as first-class project children
- completed tasks have a first-class summary artifact

### Phase 2 — Read-only project UI exposure

Goal:

Expose projects as first-class user-facing objects in the web UI.

Deliverables:

- add `/projects` page
- add `/projects/:id` detail page
- render project overview + plan + task list + task summaries
- rename visible UI language from “workstreams” to “projects” where appropriate

Acceptance criteria:

- projects are visible in the main UI
- a project can be inspected end-to-end without reading raw files manually

### Phase 3 — Project/task editing

Goal:

Make project files editable from the UI.

Deliverables:

- edit project overview fields
- edit plan steps
- edit task title/status/objective/criteria/notes
- edit task summary content
- expose raw-file inspect/edit mode where useful

Acceptance criteria:

- Patrick can manage a project entirely from the UI
- edits persist to durable files

### Phase 4 — Conversation ↔ project linkage

Goal:

Let conversations attach to and continue project work explicitly.

Deliverables:

- durable conversation → project links
- project references in conversation context rail
- project-aware continuation and fork behavior
- task references from relevant conversations

Acceptance criteria:

- ongoing work can be resumed from conversations without depending on a single transcript

### Phase 5 — Activity and daemon integration

Goal:

Make autonomous execution update projects/tasks by default.

Deliverables:

- daemon task output can target a project/task
- activity entries reference projects/tasks
- task completion or failure emits project-related activity
- scheduled/background work is inspectable through the project UI

Acceptance criteria:

- activity points to durable project/task state
- background work updates are visible without needing Telegram as source of truth

### Phase 6 — Summary generation and hardening

Goal:

Make project/task summaries a dependable quick-reference layer.

Deliverables:

- task completion summary generation flow
- project-level rolling summary updates
- summary refresh ergonomics
- migration utilities from old workstream structures if needed

Acceptance criteria:

- Patrick can understand current state from summaries first
- raw transcripts/logs are only needed for deep inspection

## Immediate implementation slice

Start with:

1. introduce the project file model in core
2. add a first-class Projects page in the web UI
3. expose read-only project detail from durable files
4. leave deeper editing, daemon linkage, and migration for follow-up slices

That gives us a concrete foundation without waiting for the full end-state.
