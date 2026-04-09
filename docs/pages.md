# Pages

Pages are the umbrella concept for durable content in `personal-agent`.

A page is durable markdown plus optional supporting files and relationships.

Today, the public workflows are still split into notes, skills, and tracked pages. There is not yet a first-class general-purpose `/pages` browser in the desktop UI, but the durable model is still page-first.

## What a page can contain

A page can hold:

- markdown content
- frontmatter metadata
- tags
- parent / related links
- supporting files such as `references/`, `attachments/`, `documents/`, or `artifacts/`

## Current page roles

### Note pages

Reusable knowledge.

Common shapes:

- `notes/<id>.md`
- `notes/<id>/INDEX.md`

### Skill pages

Reusable procedures.

Common shape:

- `_skills/<skill>/SKILL.md`

### Tracked pages

Ongoing work with structured execution state.

Common shape:

- `projects/<projectId>/project.md`
- `projects/<projectId>/state.yaml`

## Durable root

By default, durable pages live under:

```text
~/Documents/personal-agent/
```

Machine-local runtime paths are not the canonical durable store for pages.

## Why the page model matters even now

Even without a broad page browser, the page model explains why notes, skills, and projects feel coherent:

- they are all durable content
- they all live in the same vault
- they can link to each other
- they differ mainly by role, not by being unrelated systems

## Current product reality

Lead with the concrete role when you are doing work:

- use a **note page** for knowledge
- use a **skill page** for procedure
- use a **tracked page** for active work

Use **page** when you are talking about the shared durable model behind all three.

## Related docs

- [Knowledge Management System](./knowledge-system.md)
- [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md)
- [Tracked Pages](./projects.md)
- [Nodes](./nodes.md)
