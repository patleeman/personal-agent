# Projects

Projects are the durable home for ongoing work in `personal-agent`.

Use a project when a thread of work should survive the current conversation and you want durable status, next steps, blockers, notes, or project files.

Do not use a project for general reusable knowledge. That belongs in a note node. Do not keep the same topic as both a top-level note and a project unless they are genuinely different things.

## Mental model

A useful rule of thumb is:

- conversation = active interaction right now
- project = durable tracked work
- note = reusable knowledge or reference
- skill = reusable procedure

If the work should still make sense next week and has an active plan, it probably belongs in a project.

## On-disk shape

Projects live under:

- `~/.local/state/personal-agent/sync/projects/<projectId>/state.yaml`
- `~/.local/state/personal-agent/sync/projects/<projectId>/INDEX.md`
- `~/.local/state/personal-agent/sync/projects/<projectId>/notes/`
- `~/.local/state/personal-agent/sync/projects/<projectId>/attachments/`
- `~/.local/state/personal-agent/sync/projects/<projectId>/artifacts/`

`state.yaml` is the structured project state.

`INDEX.md` is the human-readable overview and handoff document.

## What goes where

### `state.yaml`

Use `state.yaml` for compact structured state such as:

- `description`
- `repoRoot`
- `requirements.goal`
- `requirements.acceptanceCriteria[]`
- `blockers`
- `currentFocus`
- `recentProgress`
- `planSummary`
- `completionSummary`
- `plan.milestones[]`
- `plan.tasks[]`

Keep it concise. Projects are not meant to become mini PM systems.

### `INDEX.md`

Use `INDEX.md` for the durable human story:

- what the project is
- why it exists
- the current direction
- the most important constraints or decisions
- the shipped result or final decision when it is done

The frontmatter is also where project identity lives:

- `id`
- `kind: project`
- `title`
- `summary`
- `status`
- `ownerProfile`
- `createdAt`
- `updatedAt`

### `notes/`

Use project notes for material that belongs to one project but would bloat the overview doc:

- design notes
- decision notes
- checkpoints
- meeting notes
- detailed research
- implementation sketches

### `attachments/` and `artifacts/`

Use these for project-specific files you want to keep with the work:

- screenshots
- reports
- exports
- sample data
- generated deliverables

## Writing style

Use these defaults:

- prefer human-readable titles; keep raw slugs in ids and directory names
- keep `summary` to one sentence
- start `INDEX.md` with a plain-English overview
- keep `INDEX.md` high-signal and move long detail into project notes
- avoid template filler and empty headings
- prefer a few concrete bullets over bloated PM boilerplate
- keep `currentFocus` and `recentProgress` truthful and current
- when a project is done, say what shipped or what decision was made

A bad project doc reads like scaffolding. A good project doc reads like a concise handoff.

## Notes vs projects

Use a project when the content is about one active workstream.

Use a note when the content is reusable outside one active project.

Good examples for projects:

- a feature or product initiative
- a migration
- an evaluation effort
- an investigation with active next steps

Good examples for notes:

- a reusable runbook
- machine or environment reference notes
- architecture guidance used by multiple projects
- a decision or reference that should outlive one workstream

If a top-level note grows active status, blockers, and next steps, promote it into a project.

## Status and archiving

Projects should usually use a small status vocabulary:

- `active`
- `paused`
- `done`

`archivedAt` is separate from workflow status. Use it to hide finished or inactive work without deleting it.

## Linked conversations

Conversations can reference one or more projects.

Those conversation ↔ project links stay in local runtime state, not in portable project files.

Do not store conversation ids or session ids in `state.yaml`, `INDEX.md`, or project note frontmatter.

## Validation

Validate projects with:

```bash
node scripts/validate-projects.mjs --profile <profile>
node scripts/validate-projects.mjs --profile <profile> --project <projectId>
node scripts/validate-projects.mjs --path <absolute-path-to-state.yaml>
```

## Scheduled tasks vs project tasks

Project tasks are just project checklist items.

Scheduled tasks are daemon automation definitions under:

- `~/.local/state/personal-agent/sync/tasks/*.task.md`

See [Scheduled Tasks](./scheduled-tasks.md).

## Related docs

- [Decision Guide](./decision-guide.md)
- [Conversations](./conversations.md)
- [How personal-agent works](./how-it-works.md)
- [Profiles, AGENTS, Notes, and Skills](./profiles-memory-skills.md)
- [Scheduled Tasks](./scheduled-tasks.md)
