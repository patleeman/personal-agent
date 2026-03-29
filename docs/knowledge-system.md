# Knowledge Management System

This page explains `personal-agent`'s durable knowledge system as one cohesive memory model.

The short version is:

- **AGENTS** stores durable behavior and preferences
- **notes** store reusable knowledge
- **skills** store reusable procedures
- **projects** store active tracked work
- **nodes** are the file model that makes notes, skills, and projects consistent

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

### 4. Project nodes = working memory for real work

Projects are durable tracked work.

Use them for:

- goals
- blockers
- current focus
- recent progress
- milestones and tasks
- project-specific notes and files

A project answers:

> what is happening in this active workstream?

## Nodes are the file model, not the whole mental model

Notes, skills, and projects are all **nodes**.

That means they share a common durable structure:

- directory-based storage
- `INDEX.md` as the canonical human entrypoint
- optional `state.yaml` for structured state
- supporting directories when needed

This is why the system is cohesive.

Nodes are not separate systems for notes, skills, and projects.
They are one file model with different semantic roles.

A simple way to say it:

- **node** = storage format
- **note / skill / project** = memory role

## The four main durable homes

| Memory role | Durable home | Use it for | Do not default to |
| --- | --- | --- | --- |
| Behavioral memory | `AGENTS.md` | preferences, policy, durable behavior | note nodes or project state |
| Knowledge memory | note nodes under `sync/notes/` | reusable facts and references | projects for generic knowledge |
| Procedural memory | skill nodes under `sync/skills/` | reusable workflows | AGENTS for long procedures |
| Working memory | project nodes under `sync/projects/` | active tracked work | top-level notes for live project state |

## What makes this a knowledge-management system

The point is not just storing files.
The point is giving the agent one sparse, durable place for each kind of memory.

The system works when these boundaries stay clear:

- reusable knowledge goes in **notes**
- reusable procedure goes in **skills**
- active tracked work goes in **projects**
- stable behavioral guidance goes in **AGENTS**

That gives the agent a durable map of:

- what to know
- how to act
- what is in progress
- how Patrick wants the agent to behave

## Relationships between the memory types

These memory types should reinforce each other instead of duplicating each other.

Typical patterns:

- a **project** links to or cites **notes** it depends on
- a **skill** can reference **notes** for deeper background
- a **project** can depend on a **skill** as the recommended procedure
- `AGENTS.md` can instruct the agent which notes or skills matter more in a profile

A healthy pattern looks like this:

- **AGENTS** gives the behavioral lens
- **notes** provide durable facts
- **skills** provide durable methods
- **projects** provide current work context

## The anti-duplication rule

The system gets messy when the same topic exists in multiple top-level homes without a clear reason.

Avoid this by default:

- do not keep the same active work as both a top-level note and a project
- do not copy a long procedure into both AGENTS and a skill
- do not store reusable knowledge inside a project unless it is truly project-specific
- do not create empty structure notes just to point at a project or skill

Prefer one canonical home per topic.

If supporting material belongs elsewhere, link to it instead of copying it.

## How information should move through the system

This is the part that makes the system feel alive instead of static.

### Conversation → note

When a conversation clearly produces reusable knowledge, distill it into a note.
Keep raw conversations raw by default. Do not passively mine every transcript. In the web UI, closing a conversation can schedule one conservative background self-distill pass for that same thread, with a high bar and a no-op default.

### Conversation → project

When a conversation turns into ongoing work, create or update a project.

### Repeated manual process → skill

When the same procedure keeps happening, extract it into a skill.

### Repeated standing preference → `AGENTS.md`

When a pattern is really a durable user preference or standing instruction, put it in `AGENTS.md`.

### Note → project

If a note grows active status, blockers, and next steps, it probably wants to become a project.

### Project → note

If project-specific material becomes generally reusable knowledge, distill it into a note.
That same high bar applies here too: prefer a small explicit durable update over broad transcript-to-note dumping.

That movement is normal. The system should stay sparse, but it does evolve.

## Shared knowledge vs active work

This is the most important distinction.

### Shared knowledge

Shared knowledge should still make sense outside the current workstream.

That belongs in:

- notes
- skills
- AGENTS

### Active work

Active work is tied to one piece of ongoing execution.

That belongs in:

- projects
- project notes
- project attachments/artifacts

If something should still be useful next month even after the current project ends, it probably belongs outside the project.

## Retrieval model for agents

When an agent needs context, the intended retrieval pattern is:

1. load relevant `AGENTS.md` for behavior and preferences
2. load relevant skill nodes for procedure
3. load relevant note nodes for durable knowledge
4. load the project node if the task is about active work

This is why the docs should describe these as one knowledge system rather than separate product features.

## `pa note` is only one slice of the system

The old naming can be confusing.

`pa note` operates on shared **note nodes** under `sync/notes/`.

That does **not** mean the whole durable memory system is only note nodes.

The broader memory system is:

- `AGENTS.md`
- note nodes
- skill nodes
- project nodes

`pa note` is just the CLI surface for one part of it.

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
- [Nodes](./nodes.md)
- [Profiles, AGENTS, Notes, and Skills](./profiles-memory-skills.md)
- [Projects](./projects.md)
