# Tracked Pages

Tracked pages are the durable home for ongoing work in `personal-agent`.

Use a tracked page when a thread of work should survive the current conversation and you want durable status, next steps, blockers, child pages, or page files.

Do not use a tracked page for general reusable knowledge. That belongs in a normal page. Do not keep the same topic as both a top-level reusable page and a tracked page unless they are genuinely different things.

## Mental model

A useful rule of thumb is:

- conversation = active interaction right now
- page = durable knowledge or tracked work
- tracked page = durable tracked work with structured execution state
- skill = reusable procedure

If the work should still make sense next week and has an active plan, it probably belongs in a tracked page.

## On-disk shape

Tracked pages are stored in project packages:

- `~/.local/state/personal-agent/sync/projects/<projectId>/project.md`
- `~/.local/state/personal-agent/sync/projects/<projectId>/state.yaml`
- `~/.local/state/personal-agent/sync/projects/<projectId>/attachments/`
- `~/.local/state/personal-agent/sync/projects/<projectId>/artifacts/`
- optional supporting files under `~/.local/state/personal-agent/sync/projects/<projectId>/documents/`
- optional child pages anywhere under `sync/projects/<projectId>/` or `sync/notes/` with `links.parent: <projectId>`

`project.md` is the canonical tracked-page document.

## What goes where

### `project.md`

Use `project.md` for the durable tracked-page record:

- what the work is
- why it exists
- the current direction
- the most important constraints or decisions
- the shipped result or final decision when it is done
- compact structured sections like goal, blockers, progress, milestones, and tasks

The frontmatter is also where tracked-page identity lives:

- `id`
- `title`
- `summary`
- `status`
- tracked-page tags like `type:project`, `profile:<profile>`, and optional `cwd:<repoRoot>`
- `createdAt`
- `updatedAt`

### Child pages

Use child pages for material that belongs to one tracked page but would bloat the overview doc:

- design notes
- decision logs
- checkpoints
- meeting writeups
- detailed research
- implementation sketches

They are normal pages with `links.parent: <projectId>`, not files in a special tracked-page-only notes bucket.

### `attachments/` and `artifacts/`

Use these for work-specific files you want to keep with the page:

- screenshots
- reports
- exports
- sample data
- generated deliverables

These are durable tracked-page files, not conversation artifact-panel records. See [Artifacts and Rendered Outputs](./artifacts.md).

### `documents/`

Use `documents/` sparingly for supporting files that should live with the tracked-page package but do not belong in the main page or a child page.

## Writing style

Use these defaults:

- prefer human-readable titles; keep raw slugs in ids and directory names
- keep `summary` to one sentence
- start `project.md` with a plain-English overview
- keep `project.md` high-signal and move long detail into child pages
- avoid template filler and empty headings
- prefer a few concrete bullets over bloated PM boilerplate
- keep current status and recent progress truthful and current
- when a tracked page is done, say what shipped or what decision was made

A bad tracked-page doc reads like scaffolding. A good tracked-page doc reads like a concise handoff.

## Reusable pages vs tracked pages

Use a tracked page when the content is about one active workstream.

Use a normal page when the content is reusable outside one active tracked page.

Good examples for tracked pages:

- a feature or product initiative
- a migration
- an evaluation effort
- an investigation with active next steps

Good examples for reusable pages:

- a reusable runbook
- machine or environment reference notes
- architecture guidance used by multiple projects
- a decision or reference that should outlive one workstream

If a top-level reusable page grows active status, blockers, and next steps, promote it into a tracked page.

## Status and archiving

Projects should usually use a small status vocabulary:

- `active`
- `paused`
- `done`

`archivedAt` is separate from workflow status. Use it to hide finished or inactive work without deleting it.

## Linked conversations

Conversations can reference one or more pages.

Those conversation ↔ page links stay in local runtime state, not in portable tracked-page files.

Do not store conversation ids or session ids in tracked pages or child-page frontmatter.

## Validation

Validate projects with:

```bash
node scripts/validate-projects.mjs --profile <profile>
node scripts/validate-projects.mjs --profile <profile> --project <projectId>
node scripts/validate-projects.mjs --path <absolute-path-to-project-state.yaml>
```

## Scheduled tasks vs tracked-page tasks

Tracked-page tasks are just tracked-page checklist items.

Scheduled tasks are daemon automation definitions under:

- `~/.local/state/personal-agent/sync/_tasks/*.task.md`

See [Scheduled Tasks](./scheduled-tasks.md).

## Related docs

- [Decision Guide](./decision-guide.md)
- [Knowledge Management System](./knowledge-system.md)
- [Conversations](./conversations.md)
- [Artifacts and Rendered Outputs](./artifacts.md)
- [How personal-agent works](./how-it-works.md)
- [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md)
- [Scheduled Tasks](./scheduled-tasks.md)
