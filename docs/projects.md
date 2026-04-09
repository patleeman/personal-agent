# Tracked Pages

Tracked pages are the durable home for ongoing work in `personal-agent`.

Use a tracked page when the work should survive the current conversation and you want durable status, next steps, milestones, blockers, attachments, or related artifacts.

## Mental model

A useful rule of thumb:

- conversation = active execution right now
- note page = reusable knowledge
- skill page = reusable procedure
- tracked page = durable active work

If the work should still make sense next week and needs a living status record, it probably belongs in a tracked page.

## On-disk shape

Tracked pages live in project packages under the durable vault:

```text
~/Documents/personal-agent/projects/<projectId>/
├── project.md
├── state.yaml
├── attachments/
├── artifacts/
└── documents/
```

`project.md` is the main human-readable record.

`state.yaml` is the structured execution state.

## What goes where

### `project.md`

Use it for:

- what the work is
- why it exists
- current summary
- plan and notes that should stay human-readable
- links to related work

### `state.yaml`

Use it for structured status such as:

- status and milestones
- tasks / next steps
- blockers
- timestamps
- machine-readable validation data

### Supporting directories

Use these only when they add value:

- `attachments/` for files that belong to the tracked work
- `artifacts/` for rendered deliverables kept with the project
- `documents/` for supporting docs that are too big or specific for `project.md`

## Child pages

Tracked work can have child pages.

Those children can live inside the project package or elsewhere in the vault as long as the relationship is explicit.

## What does not belong here

Do not use a tracked page for:

- general reusable reference material
- profile behavior and preferences
- work that is only a one-off conversation with no durable execution state

## Validation

Validate tracked pages with:

```bash
npm run validate:projects
node scripts/validate-projects.mjs --profile <profile>
node scripts/validate-projects.mjs --project <projectId>
```

## Related docs

- [Conversations](./conversations.md)
- [Knowledge Management System](./knowledge-system.md)
- [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md)
