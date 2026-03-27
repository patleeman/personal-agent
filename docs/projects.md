# Projects

Projects are the durable home for ongoing work in `personal-agent`.

The model is intentionally small.

A project is mostly:

- a title
- a short summary
- a status
- an optional repo root
- one main project doc (`INDEX.md`)
- a flat task list
- appended notes
- a single files bucket
- a tiny derived activity log

Projects are not meant to be mini PM systems.

## Mental model

Use a project when a thread of work should survive the current conversation.

A good project usually starts like this:

1. Talk about something.
2. Realize it is a multi-step thing.
3. Create a project.
4. Keep attaching notes, tasks, files, and conversations as the work evolves.

That is the whole point.

## On-disk shape

Projects live under:

- `~/.local/state/personal-agent/sync/projects/<projectId>/state.yaml`
- `~/.local/state/personal-agent/sync/projects/<projectId>/INDEX.md`
- `~/.local/state/personal-agent/sync/projects/<projectId>/notes/`
- `~/.local/state/personal-agent/sync/projects/<projectId>/files/`

`state.yaml` is the small structured record.

`INDEX.md` is the main project doc.

## What `state.yaml` stores

The structured record is deliberately minimal.

It stores:

- `repoRoot` (optional)
- `status`
- `archivedAt` (optional)
- `plan.tasks[]`

Identity and list metadata live in `INDEX.md` frontmatter:

- `id`
- `kind: project`
- `title`
- `summary`
- `status`
- `ownerProfile`
- `createdAt`
- `updatedAt`

## Main project doc

`INDEX.md` is the canonical narrative surface for a project.

Put the evolving plan, context, decisions, and completion notes there if you want them in one place.

The UI no longer treats requirements, plan, and completion as separate first-class project concepts.
Those can still exist as headings in the doc if useful, but they are just document structure now.

## Tasks

Project tasks are a flat list.

Use them for simple durable work tracking inside the project.

Milestones are no longer part of the normal project workflow.

## Notes

Project notes live under `notes/`.

Use them for:

- decisions
- questions
- meeting notes
- checkpoints
- running notes

## Files

Project files live under `files/`.

There is no attachment vs artifact distinction in the main project model anymore.

Use files for anything you want to keep with the project:

- screenshots
- PDFs
- exports
- reports
- sample data

Legacy attachment/artifact directories are migrated into this single bucket.

## Activity

The activity view is intentionally tiny.

It is a recent derived log built from meaningful events like:

- project created
- project doc updated
- note updated
- file added
- linked conversation activity

It is meant to be scan-friendly, not a second narrative surface.

## Linked conversations

Conversations can reference one or more projects.

Those conversation ↔ project links stay in local runtime state, not in portable project files.

That keeps projects portable while still letting the UI show related conversations.

## Status

Projects are expected to use a small status vocabulary:

- `active`
- `paused`
- `done`

`archivedAt` is separate from workflow status and is used to hide finished work from the active list without deleting it.

## Scheduled tasks vs project tasks

Project tasks are just project checklist items.

Scheduled tasks are daemon automation definitions under:

- `~/.local/state/personal-agent/sync/tasks/*.task.md`

See [Scheduled Tasks](./scheduled-tasks.md).
