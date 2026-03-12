# Projects

Projects are the durable home for ongoing work in `personal-agent`.

Use a project when you want to track:

- the goal
- current status
- blockers
- recent progress
- milestones
- execution tasks

If the work should still make sense after the current conversation ends, it probably belongs in a project.

## Where projects live

Projects are scoped to the active profile.

Canonical location:

- `profiles/<profile>/agent/projects/<projectId>/PROJECT.yaml`

This `PROJECT.yaml` file is the canonical durable project record.

## What a project contains

A project can store:

- `id`
- `description`
- `summary`
- `status`
- `repoRoot` (optional)
- `blockers`
- `currentFocus`
- `recentProgress`
- `plan.currentMilestoneId`
- `plan.milestones[]`
- `plan.tasks[]`

## Example

```yaml
id: improve-web-ui
createdAt: 2026-03-12T12:00:00.000Z
updatedAt: 2026-03-12T14:15:00.000Z
description: Improve the personal-agent web UI docs and navigation.
repoRoot: /Users/patrick/workingdir/personal-agent
summary: Reorganizing docs into a single user-facing set.
status: in_progress
blockers: []
currentFocus: Rewrite the docs landing page and user guides.
recentProgress:
  - Reframed the docs around durable features.
  - Added separate guides for the web UI and projects.
plan:
  currentMilestoneId: execute-work
  milestones:
    - id: refine-plan
      title: Refine the plan
      status: completed
    - id: execute-work
      title: Execute the work
      status: in_progress
    - id: verify-result
      title: Verify the result
      status: pending
  tasks:
    - id: rewrite-readme
      title: Rewrite docs/README.md
      status: completed
      milestoneId: execute-work
    - id: add-projects-guide
      title: Add a dedicated projects guide
      status: in_progress
      milestoneId: execute-work
```

## When to use a project

Use a project for:

- feature work
- multi-step investigations
- work that spans multiple sessions
- anything with milestones or blockers

Do not use a project for:

- reusable knowledge that belongs in memory
- simple async notices that belong in the inbox
- scheduled automation definitions that belong in `*.task.md`

## Project tasks are not scheduled tasks

This distinction is important.

### Project tasks

Project tasks are checklist items inside `PROJECT.yaml`.

They represent execution work inside a project plan.

### Scheduled tasks

Scheduled tasks are daemon-run automation under:

- `profiles/<profile>/agent/tasks/*.task.md`

They are for unattended prompts on cron or one-time schedules.

See [Scheduled Tasks](./scheduled-tasks.md).

## Creating and managing projects

### In the web UI

Use the Projects page to:

- create a project from a short description
- inspect milestones and tasks
- edit project metadata
- open the canonical `PROJECT.yaml`

See [Web UI Guide](./web-ui.md).

### Through the agent project tool

Inside a conversation, ask the agent to use the durable project tool when you want changes to persist.

The project tool supports:

- list
- create
- get
- update
- reference / unreference
- add or update milestones
- add or update project tasks

This is the preferred structured path for agents.

## Referencing projects in conversations

A conversation can reference one or more projects.

That matters because:

- the project stays in working context for later turns
- the conversation can inherit durable project context
- the web UI can infer working directory from a sole referenced project with `repoRoot`

Ways this happens today:

- reference a project in the web UI conversation flow
- mention `@project-id` in supported contexts
- use the project tool's `reference` action

## `repoRoot` and working directory behavior

A project may store an optional `repoRoot`.

This is useful when the project corresponds to a real repo or working tree.

When a new conversation references exactly one project with a `repoRoot`, and no explicit cwd is provided, that repo root can become the initial working directory.

So `repoRoot` is a durable bridge between project context and execution context.

## Suggested project workflow

A good pattern is:

1. create the project when work starts to span more than one turn
2. keep `summary`, `currentFocus`, `blockers`, and `recentProgress` current
3. use milestones for the larger phases
4. use project tasks for the concrete checklist
5. let the inbox surface important async events related to the work

## What not to store in a project

Avoid putting these into `PROJECT.yaml`:

- conversation ids
- session ids
- machine-local runtime state
- raw logs better stored elsewhere

Projects should stay portable.

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Web UI Guide](./web-ui.md)
- [Inbox and Activity](./inbox.md)
- [Profiles, Memory, and Skills](./profiles-memory-skills.md)
