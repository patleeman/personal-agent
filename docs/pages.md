# Pages

Pages are the universal durable unit in `personal-agent`.

A page is a place for information. It can contain content, link to other pages, sit under a parent page, carry tags, and include supporting files when needed.

This is the conceptual product model.

The current desktop UI and public CLI are narrower than this page: they do **not** currently expose a full `/pages` browser or `pa page` workflow. Use the vault files directly for broad page work, and treat this doc as the durable model the rest of the system is organized around.

## Core model

A page is durable markdown plus optional supporting files:

- notes live in `notes/` as `<id>.md` or `<id>/INDEX.md` when they need a package directory; the filename or package directory should match the page `id`
- skills live in `_skills/<skill>/SKILL.md`
- tracked pages live in `projects/<projectId>/project.md`
- optional supporting directories such as `documents/`, `references/`, `attachments/`, `scripts/`, and `artifacts/`
- lightweight structure through frontmatter, tags, relationships, and supporting files

## Durable root

The canonical durable store is the shared vault root under:

- `~/Documents/personal-agent/{notes,projects,_skills}/`

Machine-local runtime paths such as `~/.local/state/personal-agent/pi-agent-runtime/notes` are not a supported durable note store. If legacy runtime notes are found there, the runtime migrates them into the vault `notes/` directory and then treats the vault copy as canonical.

That path is an implementation detail. The user model is:

- **page** = durable thing
- **note / project / skill** = page role or workflow lens

## What pages can do

Pages can:

- hold markdown content
- link to other pages
- have a parent page
- carry tags
- expose optional properties like status
- include supporting files

That is the whole base object.

Everything else should be layered on top of it.

## Page roles

`personal-agent` still has recognizable constructs, but they are not separate storage objects anymore.

### Pages

Use pages for reusable knowledge.

Examples:

- references
- runbooks
- research notes
- architecture notes
- decision summaries

Convention:

- tag with `type:note` when that helps retrieval
- keep the body human-readable
- use `references/` for supporting material

### Skill pages

Use skill pages for reusable procedures.

Examples:

- browser automation workflows
- release workflows
- operating runbooks

Convention:

- tag with `type:skill`
- keep Pi-compatible `name` and `description` frontmatter when runtime loading needs it
- store scripts and references alongside the page

### Tracked pages

Use tracked pages for tracked work.

Examples:

- active goals
- blockers
- milestones
- handoff context
- project-local files

Convention:

- tag with `type:project`
- keep goals, status, blockers, and progress in markdown sections
- use supporting files when the project needs attachments, notes, or artifacts

## Page entry files

Every page entry file starts with YAML frontmatter followed by markdown body content.

Example:

```yaml
---
id: unified-run-architecture
title: Unified Run Architecture
summary: Unify runs, scheduled tasks, and deferred resumes into one model.
description: Durable architecture page and implementation record.
status: active
createdAt: 2026-04-01T00:00:00.000Z
updatedAt: 2026-04-01T00:15:00.000Z
createdBy: patrick
tags:
  - type:project
  - profile:assistant
  - cwd:/Users/patrick/workingdir/personal-agent
  - area:architecture
  - status:active
links:
  parent: platform-architecture
  related:
    - daemon-unification
---

# Unified Run Architecture

Plain markdown body.
```

### Required frontmatter fields

Every page must define:

- `id`
- `title`
- `summary`

### Common optional frontmatter fields

Use these when they add value:

- `description`
- `status`
- `createdAt`
- `updatedAt`
- `createdBy`
- `tags[]`
- `links.parent`
- `links.related[]`
- `links.conversations[]`
- `links.relationships[]`

## Tags

Tags use `key:value` strings.

### Reserved/core tags

These are the tags the runtime treats as first-class:

- `type:*` — page role (`project`, `skill`, `note`, `runbook`, ...)
- `profile:*` — ownership/filtering context
- `status:*` — operational state
- `host:*` — machine identity when relevant
- `cwd:*` — working-directory affinity
- `parent:*` — denormalized parent lookup helper

### Free-form tags

Everything else is queryable but unconstrained:

- `area:backend`
- `team:platform`
- `lang:typescript`
- `topic:gpu`

## Parent/child hierarchy

Relationships are stored child → parent only.

```yaml
links:
  parent: parent-page-id
```

Pages also carry `parent:<id>` in tags so children can be derived at read time with queries such as:

```text
parent:platform-architecture
```

The parent does not store children explicitly.

## Search

The durable model supports tag + full-text queries with Lucene-style operators:

```text
type:project AND status:active
profile:assistant AND type:skill
parent:knowledge-system-gap-closure
"build deploy"
cwd:/Users/patrick/work/*
```

Search matches against:

- tags
- id, title, summary, description
- markdown body

## UI model

The old `/pages` browser described here is not the current desktop product surface.

Today, broad page work mainly happens in the vault files themselves. The web UI exposes narrower durable surfaces such as:

- conversations
- instructions (`/instructions`)
- automations
- runs
- inbox and system state

Use those pages when they fit, and use your editor or file manager for general note/project/skill authoring.

## Migration and compatibility

Current compatibility rules:

- page remains the preferred product term
- some older docs and internal code still say `node`
- older `/pages`, `pa page`, and `pa node` references should be treated as legacy documentation, not the current public workflow
- the old `sync/nodes/` mirror is legacy debt and should not be used as a source of truth

## Related docs

- [Knowledge Management System](./knowledge-system.md)
- [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md)
- [Tracked Pages](./projects.md)
- [Command-Line Guide (`pa`)](./command-line.md)
- [Nodes (legacy/internal term)](./nodes.md)
