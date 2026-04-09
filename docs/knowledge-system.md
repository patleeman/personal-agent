# Knowledge Management System

This page explains `personal-agent`'s durable memory model.

The short version is:

- **`AGENTS.md`** stores behavior and preferences
- **pages** are the umbrella concept for durable content
- **notes** store reusable knowledge
- **skills** store reusable procedures
- **projects** store ongoing tracked work

## One memory system, different roles

### `AGENTS.md` = behavioral memory

Use profile `AGENTS.md` files for:

- standing instructions
- role and mission
- preference defaults
- durable behavior rules
- profile-specific operating constraints

Do not use `AGENTS.md` as your project notebook.

### Notes = knowledge memory

Use note pages for facts and references that should be reusable later:

- research notes
- architecture notes
- environment references
- distilled learnings
- decision context that is not tied to one active execution plan

### Skills = procedural memory

Use skill pages for reusable “how to do this” procedures.

A good skill is something you expect to invoke again across different tasks.

### Projects = working memory that needs to persist

Use tracked pages for work that has a durable plan or status:

- ongoing features
- multi-step investigations
- work with blockers, milestones, or attachments

## Where it lives

By default, the durable vault is:

```text
~/Documents/personal-agent/
├── _profiles/
│   └── <profile>/
│       ├── AGENTS.md
│       ├── settings.json
│       └── models.json
├── _skills/
│   └── <skill>/SKILL.md
├── notes/
└── projects/
```

That vault is the source of truth for durable knowledge.

## Pages are the umbrella term

The product model is **page-first** even though the current UI is narrower.

In practice today:

- note pages live under `notes/`
- skill pages live under `_skills/`
- tracked pages live under `projects/`

A full page browser is not the main public UI yet, but the durable model is still page-based.

## How to choose quickly

Use this rule:

- “How should the agent behave?” → `AGENTS.md`
- “What should be remembered as a reusable fact?” → note page
- “How should this workflow be repeated?” → skill page
- “What work is still in progress?” → tracked page

## What not to do

- do not keep durable knowledge only in old conversation text
- do not put long reusable procedures into `AGENTS.md`
- do not use a tracked page for generic knowledge that should outlive the project
- do not treat machine-local runtime state as the portable memory layer

## Notes on nodes

You will still see the word **node** in some implementation details and legacy APIs.

The preferred mental model is still:

- page = durable thing
- note / skill / project = page role

See [Nodes](./nodes.md) for the compatibility note.

## Related docs

- [Pages](./pages.md)
- [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md)
- [Tracked Pages](./projects.md)
- [Nodes](./nodes.md)
