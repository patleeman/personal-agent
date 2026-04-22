# Projects

Projects are the optional structured durable-work surface.

Use one only when a plain doc or conversation is no longer enough.

## When to use a project

Good fits:

- work with milestones or durable tasks
- work with blockers and validation status
- handoff-ready work that needs a stable state file
- work with durable attachments or artifacts that belong to the project

Do not default to a project for ordinary notes or one-off conversations.

## Current on-disk shape

```text
<vault-root>/projects/<projectId>/
├── state.yaml
├── project.md
├── tasks/
├── files/
├── attachments/
└── artifacts/
```

Important pieces:

- `state.yaml` — structured machine-readable state
- `project.md` — human-readable summary and context
- `tasks/` — optional task-level files when the project needs them
- `attachments/` — project-owned supporting files
- `artifacts/` — project-owned deliverables and exports

## What goes where

### `project.md`

Use it for:

- what the project is
- why it exists
- current summary
- design notes that should stay readable
- links to related docs and threads

### `state.yaml`

Use it for:

- status
- milestones
- tasks
- blockers
- validation facts
- timestamps and machine-readable progress

## What not to do

- do not use a project for general reusable reference material
- do not use a project when a normal doc would do
- do not confuse project tasks with daemon scheduled tasks

## Validation

Validate project files with:

```bash
npm run validate:projects
```

## Related docs

- [Decision Guide](./decision-guide.md)
- [Knowledge System](./knowledge-system.md)
- [Conversations](./conversations.md)
- [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md)
