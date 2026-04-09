# Knowledge Management System

This page explains `personal-agent`'s durable knowledge system as one cohesive memory model.

The short version is:

- **AGENTS** stores durable behavior and preferences
- **pages** are the universal durable unit
- **notes** store reusable knowledge
- **skills** store reusable procedures
- **projects** store active tracked work

The system only feels fragmented if you look at the files first.
The real model is simpler: one durable memory system, with a few different homes for different kinds of memory.

## One memory system, different memory roles

Think about durable memory in `personal-agent` in four layers.

### 1. `AGENTS.md` = behavioral memory

This is where durable behavior lives.

Use it for:

- user preferences
- standing instructions
- role/mission
- operating constraints
- profile-specific behavior

`AGENTS.md` answers:

> how should this agent behave?

It is not the place for project state or general reference notes.

### 2. Note nodes = knowledge memory

Notes are reusable knowledge.

Use them for:

- references
- runbooks
- research notes
- architecture notes
- decision summaries
- distilled facts that should outlive one conversation or project

A note answers:

> what should the agent know later?

### 3. Skill nodes = procedural memory

Skills are reusable procedures.

Use them for:

- workflows
- operational sequences
- repeatable runbooks
- domain-specific operating patterns

A skill answers:

> how should the agent do this kind of task?

### 4. Tracked pages = working memory for real work

Tracked pages are durable tracked work.

Use them for:

- goals
- blockers
- current focus
- recent progress
- milestones and tasks
- work-specific pages and files

A tracked page answers:

> what is happening in this active workstream?

## Pages are the product model; nodes are the storage term

Notes, skills, and projects are all **pages** in the product model.

Internally they still share one vault-backed durable model:

- note pages under `notes/` as markdown files or note packages when they need supporting files, with filenames or package directories matching the page `id`
- skill packages under `_skills/<skill>/SKILL.md`
- tracked pages under `projects/<projectId>/project.md` plus `state.yaml` and supporting directories
- supporting directories when needed

This is why the system is cohesive.

Pages are not separate systems for notes, skills, and projects.
They are one durable thing with different semantic roles and workflows.

A simple way to say it:

- **page** = product primitive
- **node** = storage / compatibility term
- **page / skill / tracked page** = memory role

## The four main durable homes

| Memory role | Durable home | Use it for | Do not default to |
| --- | --- | --- | --- |
| Behavioral memory | `AGENTS.md` | preferences, policy, durable behavior | node content or project state |
| Knowledge memory | pages backed by `sync/notes/` | reusable facts and references | tracked pages for generic knowledge |
| Procedural memory | skill pages backed by `sync/_skills/` | reusable workflows | AGENTS for long procedures |
| Working memory | tracked pages backed by `sync/projects/` | active tracked work | top-level reusable pages for live project state |

## What makes this a knowledge-management system

The point is not just storing files.
The point is giving the agent one sparse, durable place for each kind of memory.

The system works when these boundaries stay clear:

- reusable knowledge goes in **pages**
- reusable procedure goes in **skills**
- active tracked work goes in **tracked pages**
- stable behavioral guidance goes in **AGENTS**

That gives the agent a durable map of:

- what to know
- how to act
- what is in progress
- how Patrick wants the agent to behave

## Relationships between the memory types

These memory types should reinforce each other instead of duplicating each other.

Typical patterns:

- a **tracked page** links to or cites **pages** it depends on
- a **skill** can reference **pages** for deeper background
- a **tracked page** can depend on a **skill** as the recommended procedure
- `AGENTS.md` can instruct the agent which pages or skills matter more in a profile

A healthy pattern looks like this:

- **AGENTS** gives the behavioral lens
- **pages** provide one flexible durable unit
- **pages** provide durable facts and context
- **skills** provide durable methods
- **tracked pages** provide current work context

## The anti-duplication rule

The system gets messy when the same topic exists in multiple top-level homes without a clear reason.

Avoid this by default:

- do not keep the same active work as both a reusable page and a tracked page
- do not copy a long procedure into both AGENTS and a skill
- do not store reusable knowledge inside a tracked page unless it is truly work-specific
- do not create empty structure pages just to point at another page or skill

Prefer one canonical home per topic.

If supporting material belongs elsewhere, link to it instead of copying it.

## How information should move through the system

This is the part that makes the system feel alive instead of static.

### Conversation → page

When a conversation clearly produces reusable knowledge, distill it into a page.
Keep raw conversations raw by default. Do not passively mine every transcript.
The web UI now exposes a direct conversation → page promotion flow.

### Conversation → tracked page

When a conversation turns into ongoing work, create or update a tracked page.
The web UI now exposes a direct conversation → tracked-page promotion flow.

### Repeated manual process → skill

When the same procedure keeps happening, extract it into a skill.
The current product path is usually page → skill once the workflow is stable enough to trust.

### Repeated standing preference → `AGENTS.md`

When a pattern is really a durable user preference or standing instruction, put it in `AGENTS.md`.

### Page → tracked page

If a page grows active status, blockers, and next steps, it probably wants to become a tracked page.
The web UI now supports page → tracked-page promotion directly from the page workspace.

### Tracked page → page

If work-specific material becomes generally reusable knowledge, distill it into a normal page.
That same high bar applies here too: prefer a small explicit durable update over broad transcript-to-page dumping.
The web UI now supports tracked-page → page promotion directly from the tracked-page workspace.

That movement is normal. The system should stay sparse, but it does evolve.

## Fast capture and URL capture

Not every durable input should start life as a polished page or tracked page.

The web UI now supports two low-friction capture paths:

- **quick capture** for rough ideas or half-baked thoughts
- **URL capture** for saving a web page into the node system with a local archived reference copy

Captured items land as inbox-style pages so they can be triaged later into a normal page, promoted into a tracked page, or ignored.

## Shared knowledge vs active work

This is the most important distinction.

### Shared knowledge

Shared knowledge should still make sense outside the current workstream.

That belongs in:

- pages
- skills
- AGENTS

### Active work

Active work is tied to one piece of ongoing execution.

That belongs in:

- tracked pages
- tracked-page child pages
- tracked-page attachments/artifacts

If something should still be useful next month even after the current tracked page ends, it probably belongs outside the tracked page.

## Retrieval model for agents

When an agent needs context, the intended retrieval pattern is:

1. load relevant `AGENTS.md` for behavior and preferences
2. load relevant skill pages for procedure
3. load relevant pages for durable knowledge
4. load the tracked page if the task is about active work
5. expand through explicit node relationships when graph context is likely to matter

This is why the docs should describe these as one knowledge system rather than separate product features.

## Shared note files are only one slice of the system

The old naming can be confusing.

Shared note pages are only one subset of the durable system. They live in the vault `notes/` directory, while the broader model also includes `AGENTS.md`, skill pages, and tracked pages.

`~/.local/state/personal-agent/pi-agent-runtime/notes` is not a second supported durable store. It is only a legacy migration source; if runtime note files are found there, the loader moves them into the vault `notes/` directory and treats the vault copy as canonical.

That does **not** mean the whole durable memory system is only one narrow page subset.

The broader memory system is:

- `AGENTS.md`
- pages
- skill pages
- tracked pages

## Writing style across the system

The whole system works better when durable docs stay high-signal.

Use these defaults:

- one stable canonical home per topic
- human-readable titles
- one-sentence summaries
- plain-English opening paragraphs
- detailed material moved into supporting files when needed
- no empty scaffolding or stale placeholders

## Practical rule of thumb

If you are deciding where something belongs, ask four questions:

1. Is this a **behavior/preference**? → `AGENTS.md`
2. Is this **reusable knowledge**? → note node
3. Is this a **reusable procedure**? → skill node
4. Is this **active tracked work**? → project node

That is the whole system.

## Related docs

- [Decision Guide](./decision-guide.md)
- [How personal-agent works](./how-it-works.md)
- [Pages](./pages.md)
- [Pages](./pages.md)
- [Nodes](./nodes.md)
- [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md)
- [Tracked Pages](./projects.md)
