# Tracked Work Packages

Tracked work packages are an optional durable wrapper for ongoing work in `personal-agent`.

Use one when the work should survive the current conversation and you want structured status, next steps, milestones, blockers, or validation.

They are useful, but they are not the primary KB contract.

Most durable knowledge should still just be ordinary docs.

## Mental model

A useful rule of thumb:

- conversation = active execution right now
- doc = reusable knowledge
- skill = reusable procedure
- tracked work package = durable work that needs structured state

If the work should still make sense next week and needs a living status record, a tracked work package can help.

## Current on-disk shape

The current implementation uses project packages under the durable vault:

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

That shape is an implementation detail of the tracked-work feature, not a rule for all durable knowledge.

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
- `artifacts/` for rendered deliverables kept with the package
- `documents/` for supporting docs too specific for `project.md`

## What does not belong here

Do not use a tracked work package for:

- general reusable reference material
- standing instructions or behavior docs
- work that is only a one-off conversation with no durable execution state

## Validation

Validate tracked work packages with:

```bash
npm run validate:projects
node scripts/validate-projects.mjs --project <projectId>
```

## Related docs

- [Conversations](./conversations.md)
- [Knowledge Management System](./knowledge-system.md)
- [Conversation Context Attachments](./conversation-context.md)
- [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md)
