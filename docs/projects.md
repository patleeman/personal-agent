# Projects

Projects are the durable home for a piece of ongoing work in `personal-agent`.

A finished project can be archived so it drops out of the active list while keeping its notes, files, brief, and timeline intact.

A project is not just a plan file.

Think of it as a **cross-conversation work hub** that can hold:

- the goal
- current status
- blockers
- recent progress
- a project brief
- optional milestones
- project tasks
- appended notes
- uploaded attachments
- project artifacts
- linked conversations that reference the project

If the work should still make sense after the current conversation ends, it probably belongs in a project.

## Where project data lives

Projects are selected for the active profile by `ownerProfile` metadata.

Canonical durable files live under:

- `~/.local/state/personal-agent/sync/projects/<projectId>/state.yaml`
- `~/.local/state/personal-agent/sync/projects/<projectId>/INDEX.md`
- `~/.local/state/personal-agent/sync/projects/<projectId>/notes/`
- `~/.local/state/personal-agent/sync/projects/<projectId>/attachments/`
- `~/.local/state/personal-agent/sync/projects/<projectId>/artifacts/`

`state.yaml` remains the canonical structured project record.

`INDEX.md` is the durable human/agent handoff document for the project.

Notes, attachments, and project artifacts live alongside that record.

## Conversation links and portability

A project page can show conversations that reference the project.

That link state is stored in **local runtime state**, not in `state.yaml`.

This matters because portable repo-managed files should not store:

- conversation ids
- session ids
- machine-local runtime bindings

So the project is the durable hub, while conversation ↔ project bindings stay local.

## What `state.yaml` contains

A project can store:

- `id`
- `ownerProfile`
- `title`
- `description`
- `summary` (best used as the compact list / preview summary)
- `requirements.goal`
- `requirements.acceptanceCriteria[]`
- `planSummary` (optional narrative plan)
- `completionSummary` (optional shipped outcome summary)
- `status`
- `archivedAt` (optional timestamp used to move finished work out of the active list without deleting it)
- `repoRoot` (optional)
- `blockers`
- `currentFocus`
- `recentProgress`
- `plan.currentMilestoneId` (optional)
- `plan.milestones[]` (optional)
- `plan.tasks[]`

Milestones are now optional.

New projects start with an empty plan instead of default milestone scaffolding.

Project tasks may be unassigned to a milestone.

## Example

```yaml
id: improve-web-ui
createdAt: 2026-03-12T12:00:00.000Z
updatedAt: 2026-03-12T14:15:00.000Z
title: Improve web UI docs
description: Improve the personal-agent web UI docs and navigation.
repoRoot: /Users/patrick/workingdir/personal-agent
summary: Reorganizing docs into a clearer projects-first workflow.
requirements:
  goal: Make project pages easier to scan and recover across conversations.
  acceptanceCriteria:
    - Requirements, plan, and completion are distinct in the UI.
    - Linked conversation context is easy to discover.
planSummary: Reshape the project page around a requirements → plan → completion flow.
status: in_progress
blockers: []
currentFocus: Ship the new project detail experience.
recentProgress:
  - Removed default milestone scaffolding.
  - Added linked conversations, notes, and file resources.
plan:
  currentMilestoneId: ship-ui
  milestones:
    - id: ship-ui
      title: Ship the UI changes
      status: in_progress
  tasks:
    - id: add-project-brief
      title: Add INDEX.md support
      status: completed
      milestoneId: ship-ui
    - id: tighten-copy
      title: Update the project docs
      status: in_progress
```

A lightweight project can also start like this:

```yaml
id: investigate-rate-limit-spike
createdAt: 2026-03-13T12:00:00.000Z
updatedAt: 2026-03-13T12:00:00.000Z
title: Investigate rate limit spike
description: Understand yesterday's API rate limit spike.
summary: Fresh investigation.
requirements:
  goal: Understand what caused yesterday's API rate limit spike.
  acceptanceCriteria: []
status: created
blockers: []
currentFocus: Capture the first concrete work chunk.
recentProgress: []
planSummary: Break the work into milestones and tasks once the approach is clear.
plan:
  milestones: []
```

## Notes, attachments, and artifacts

Projects now support three separate resource buckets:

### Notes

Notes are appendable markdown entries stored under `notes/`.

Use them for:

- decisions
- questions
- meeting notes
- checkpoints
- plain running notes

### Attachments

Attachments are arbitrary uploaded files stored under `attachments/`.

Use them for:

- screenshots
- PDFs
- exported docs
- specs
- sample data

### Artifacts

Project artifacts are uploaded output files stored under `artifacts/`.

Use them for:

- deliverables
- generated outputs
- reports
- exports worth keeping with the project

## Project brief / handoff document

Each project can have a canonical `INDEX.md`.

The structured source of truth now lives primarily in `state.yaml`:

- `requirements.goal`
- `requirements.acceptanceCriteria[]`
- `planSummary`
- `completionSummary`
- milestones/tasks/current focus/blockers/recent progress

`INDEX.md` is best treated as the human-readable handoff layer when the structured fields are not enough.

In the web UI you can:

- edit the handoff document manually
- regenerate it on demand from current project state, notes, files, and linked conversations

## Linked conversations

A conversation can reference one or more projects.

When that happens:

- the conversation stays attached to the project as durable context
- the project page can show that linked conversation
- new work can continue across sessions without losing the thread

This is what makes projects the connecting line across conversations.

## `repoRoot` and working directory behavior

A project may store an optional `repoRoot`.

This is useful when the project corresponds to a real repo or working tree.

When a new conversation references exactly one project with a `repoRoot`, and no explicit cwd is provided, that repo root can become the initial working directory.
Otherwise, the web UI falls back to the saved default cwd from Settings, or the web server process cwd when no default is saved.

The Projects UI also lets you start a new conversation directly from a project.

## Project tasks are not scheduled tasks

This distinction still matters.

### Project tasks

Project tasks are checklist items inside `state.yaml`.

They represent work inside a project plan.

### Scheduled tasks

Scheduled tasks are daemon-run automation under:

- `~/.local/state/personal-agent/sync/tasks/*.task.md`

They are for unattended prompts on cron or one-time schedules.

See [Scheduled Tasks](./scheduled-tasks.md).

## Creating and managing projects

### In the web UI

From the Projects page you can:

- create a project from a short title plus a longer description
- inspect and edit `state.yaml`
- archive or restore finished projects without deleting their history
- see linked conversations
- start a new conversation from the project
- edit or regenerate the project handoff doc
- append notes
- upload attachments and project artifacts
- manage optional milestones and tasks
- view a combined project timeline

### Exporting a share package

From the project detail page in the web UI, click **Export package**.

That downloads a single `*.pa-project.json` file containing:

- the structured project record from `state.yaml`
- `INDEX.md`
- notes
- attachments and project artifacts (base64-encoded)
- related inbox activity for the project
- linked conversation transcripts

The export intentionally omits structured machine-local fields such as project repo roots, download URLs, and session file paths so the package is easier to share.

Conversation and tool output text is still included verbatim, so review the package before sending it externally.

### Through the project tool

Inside a conversation, use the `project` tool for normal durable project management.

The tool supports:

- project create / get / update / delete / archive / unarchive
- current-conversation reference / unreference
- brief saves
- note create / update / delete
- milestone create / update / move / delete
- task create / update / move / delete

Use direct file edits only when you need low-level manipulation of attachment or artifact entries outside the structured tool surface.

## Suggested workflow

A good pattern is:

1. create the project once the work spans more than one turn
2. keep `summary`, `requirements`, `planSummary`, `completionSummary`, `currentFocus`, `blockers`, and `recentProgress` current
3. keep `INDEX.md` useful as the handoff layer for future restarts
4. append notes when decisions or context accumulate
5. upload files that belong with the work
6. use milestones only when the work genuinely benefits from phases
7. use tasks for the concrete checklist
8. start new conversations from the project when you want continuity

## What not to store in a project

Avoid putting these into repo-managed project files:

- conversation ids
- session ids
- machine-local runtime state
- local path bindings that should stay in runtime state
- raw logs better stored elsewhere

Projects should stay portable even when the UI shows conversation links.

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Web UI Guide](./web-ui.md)
- [Inbox and Activity](./inbox.md)
- [Profiles, Memory, and Skills](./profiles-memory-skills.md)
