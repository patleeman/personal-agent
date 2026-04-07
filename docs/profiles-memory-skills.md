# Profiles, AGENTS, Pages, and Skills

Profiles are how `personal-agent` changes behavior, prompting, defaults, and reusable capabilities around a durable resource store.

A profile is not just a name. It is the durable resource bundle the agent runs with, selected from kind-based durable resources plus machine-local overlays.

See [Pages](./pages.md) for the product model and [Nodes](./nodes.md) for the storage compatibility term.

If you want the single conceptual overview of pages, skills, tracked pages, and `AGENTS.md` as one memory system, start with [Knowledge Management System](./knowledge-system.md).

If you need Patrick-specific preferences or standing behavior, the active profile's `AGENTS.md` is the canonical home. Use this page to understand how that fits with pages, skills, tracked pages, and layered resources.

## The layer model

Resources resolve in this order:

1. repo `defaults/agent` for shared default profile files
2. durable resource roots under `~/.local/state/personal-agent/sync/`
3. local overlay (`~/.local/state/personal-agent/config/local` by default)

In addition, repo built-ins are always available from:

- `extensions/`
- `themes/`

## What a profile can contain

The durable store can contain:

- `_profiles/<profile>/AGENTS.md`
- `_profiles/<profile>/settings.json`
- `_profiles/<profile>/models.json`
- `_skills/**`
- `notes/**`
- `tasks/*.task.md`
- `projects/<projectId>/{project.md,state.yaml}`

Repo built-ins still provide:

- `extensions/`
- `themes/`
- prompt-catalog content

## Example layout

```text
<repo>/
├── defaults/
│   └── agent/
│       └── settings.json
├── extensions/
└── themes/

~/.local/state/personal-agent/
└── sync/
    ├── _profiles/
    │   ├── default/
    │   │   ├── AGENTS.md
    │   │   ├── settings.json
    │   │   └── models.json
    │   └── datadog/
    │       ├── AGENTS.md
    │       └── settings.json
    ├── _skills/
    ├── notes/
    ├── tasks/
    └── projects/
```

## What belongs where

| Place | Use it for |
| --- | --- |
| `_profiles/<profile>/AGENTS.md` | durable role, behavior rules, and operating policy fragments |
| `_skills/<skill>/SKILL.md` | reusable workflow skill pages |
| `notes/**` | shared durable pages |
| `notes/<id>/references/**` | detailed notes, distilled captures, and supporting breakdowns for that page |
| `notes/<id>/assets/**` | non-markdown assets used by that page |
| `tasks/*.task.md` | scheduled automation |
| `projects/` | long-running tracked work |
| `_profiles/<profile>/settings.json` | profile-specific runtime defaults such as theme and model prefs |
| `_profiles/<profile>/models.json` | profile-specific model provider definitions and overrides |

## `AGENTS.md`: durable identity and behavior

`AGENTS.md` is where the durable behavioral contract lives.

Use it for:

- mission and role
- user preferences
- operating rules
- constraints and standing instructions

Do not use it for:

- transient project state
- one-off reminders
- conversation-local context

## Skill pages: reusable workflows

Skills are reusable, named workflow pages the agent can invoke when appropriate.

Use a skill node when you want something that is:

- reusable across conversations
- broader than one project
- procedural rather than purely referential

Examples:

- a morning report workflow
- a calendar workflow
- a Git or release workflow
- a browser-automation workflow

Skill pages live under `sync/_skills/<skill>/SKILL.md` and typically include supporting `scripts/`, `references/`, and `assets/` directories.

For Pi compatibility, skill node frontmatter keeps:

- `name`
- `description`

Alongside node fields such as:

- `id`
- `kind: skill`
- `title`
- `summary`

## Note nodes: durable knowledge and reference nodes

Notes are durable knowledge nodes.

Use them for:

- runbooks
- research notes
- domain references
- architecture notes
- decision summaries
- distilled conversation captures
- structure notes / maps of content when they genuinely help

A reusable page can be a single markdown file in `notes/` or a note package directory with an `INDEX.md` file when it needs supporting material. Supporting directories are freeform.

Use these naming rules:

- simple note: `notes/<id>.md`
- note package: `notes/<id>/INDEX.md`
- the filename or package directory should match the note `id`

Reusable pages may also include an optional `description` field for agent-facing guidance about how the page should be used or when it should be consulted.

```text
note-id/
├── INDEX.md
├── references/
└── assets/
```

Simple notes can also live directly as `notes/<note-id>.md`.

Typical note-node frontmatter:

```md
---
id: desktop-gpu-server
kind: note
title: Desktop GPU-enabled server notes
summary: Reference facts for a local Ubuntu GPU-enabled server.
description: Use this note when deciding whether local desktop compute is a better fit than renting remote GPUs.
status: active
tags:
  - desktop
  - gpu
  - ubuntu
updatedAt: 2026-03-28
metadata:
  area: compute
  type: reference
---
```

Use tag `structure` when a page mostly organizes other pages.
There is no separate hub kind.

Do not create empty hub or index pages by default. If a topic already has a real tracked-page or skill home, put the content there instead of duplicating it as a top-level page.

## Project pages

Tracked pages are stored under `sync/projects/<id>/` with:

- `project.md` for the human handoff / overview
- optional `documents/`, `attachments/`, and `artifacts/` directories for supporting material
- optional child pages elsewhere in `sync/projects/**` or `sync/notes/**` linked back with `links.parent: <projectId>`

See [Tracked Pages](./projects.md).

## Shared resources vs profile-targeted resources

Important convention:

- shared defaults can live in repo `defaults/agent` and shared-scoped durable files under `sync/`
- profile-targeted durable resources are selected by filename or metadata applicability
- durable note and skill pages live in the shared vault under `sync/notes/` and `sync/_skills/`

In particular:

- there is no profile-local durable `memory/` directory
- there is no supported durable note store under `pi-agent-runtime/notes`; that path is legacy migration input only
- behavior targeting belongs in durable `_profiles/<profile>/{AGENTS.md,settings.json,models.json}` and shared vault content under `notes/**`, `_skills/**`, and `projects/**`

## Pages vs tracked pages vs inbox

This distinction still matters.

Use:

- **pages** for reusable durable knowledge
- **tracked pages** for current tracked work state, handoff context, child pages, and page files
- **inbox** for asynchronous outcomes that need attention later

A good rule:

- if it is reusable knowledge, store it in a page
- if it is about one piece of ongoing work, store it in a tracked page
- if it is an async event worth noticing, surface it in the inbox
- if it already has a tracked-page or skill home, do not also keep it as a duplicate top-level page

## Writing style for pages and tracked pages

Use these defaults for durable node prose:

- keep ids stable and slug-like, but make titles human-readable
- keep `summary` to one sentence
- start the note entry file (`<id>.md` or `INDEX.md`) with a plain-English opening
- keep overview docs high-signal and move long detail into `references/` or project child pages
- avoid placeholder sections, stale scaffolding, and empty structure pages
- update or remove stale text instead of letting it linger

## Commands you will use

### Profile commands

```bash
pa profile list
pa profile show
pa profile use <name>
```

### Note-node commands

```bash
pa note list
pa note find --type reference
pa note show <id>
pa note new <id> --title "..." --summary "..." --type reference
pa note lint
```

Use `pa note` to operate on shared pages under `sync/notes/`.

`pa note new` scaffolds `notes/<note-id>.md`.
If legacy files still exist under `~/.local/state/personal-agent/pi-agent-runtime/notes`, note loads migrate them into `sync/notes/` and the vault copy becomes canonical.

## Local overlay

The optional local overlay defaults to:

- `~/.local/state/personal-agent/config/local`

Use it for machine-local additions that should not live in the repo.

It can contain the same kinds of runtime resources as a profile layer, such as:

- skills
- prompts
- themes
- extensions
- settings overrides

## Important boundary for agents

Do not store conversation ids or session ids in portable durable files.

That includes:

- note-node frontmatter/metadata
- tracked-page files
- activity frontmatter
- any profile-local schema meant to be portable

Conversation-local bindings belong in local runtime state.

## Related docs

- [Decision Guide](./decision-guide.md)
- [Knowledge Management System](./knowledge-system.md)
- [Agent Tool Map](./agent-tool-map.md)
- [Nodes](./nodes.md)
- [How personal-agent works](./how-it-works.md)
- [Tracked Pages](./projects.md)
- [Conversations](./conversations.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Inbox and Activity](./inbox.md)
- [Skills and Runtime Capabilities](./skills-and-capabilities.md)
