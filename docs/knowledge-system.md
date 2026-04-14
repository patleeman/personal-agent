# Knowledge Management System

This page explains the durable knowledge model for `personal-agent`.

The short version is:

- the KB is a file-backed vault of markdown docs
- docs are the default unit of durable knowledge
- skills are the only special shared folder contract
- instruction files are selected docs, not a vault profile system
- conversations can reference docs either one-shot or persistently

## One knowledge system, different uses

### Instruction files = behavioral context

Instruction files shape how the agent behaves because they were selected locally.

Use them for:

- standing instructions
- role and mission
- preference defaults
- operating constraints

An instruction file can live anywhere. `AGENTS.md` is a useful convention, but not the only valid shape.

### Docs = knowledge context

Use ordinary docs for reusable information such as:

- research notes
- architecture notes
- references
- plans and design briefs
- distilled learnings

A doc can be a single markdown file or a doc package with an `INDEX.md`.

### Skills = procedural context

Use skill packages for reusable workflows the agent should invoke again later.

The shared skill contract is:

```text
skills/<skill>/SKILL.md
```

## What is special and what is not

These are special:

- selected instruction files
- `skills/<skill>/SKILL.md`
- conversation attachments and mentions

These are not special KB contracts:

- `notes/`
- `projects/`
- `_profiles/`
- folder names used to imply semantics by themselves

Those can still exist as conventions or implementation details, but the durable model should stay doc-first.

## Where it lives

By default, the durable vault is:

```text
~/Documents/personal-agent/
├── skills/
├── work/
├── systems/
├── people/
└── ...
```

That vault is the source of truth for portable knowledge.

Machine-local runtime state lives separately under `~/.local/state/personal-agent/`.

## Conversations and the vault

A conversation should be able to use vault docs in two ways:

- mention a doc with `@...` for one turn
- attach docs persistently for the lifetime of the conversation

That keeps the roles clean:

- the vault stores the docs
- local config selects instruction files and skill dirs
- the conversation stores references to the docs it cares about

## How to choose quickly

Use this rule:

- “How should the agent behave?” → selected instruction file
- “What should be remembered as reusable knowledge?” → ordinary doc
- “How should this workflow be repeated?” → skill
- “What should stay in scope for this thread?” → attached conversation doc

## What not to do

- do not treat folder names as the primary meaning system
- do not put reusable procedures into random docs when they should be skills
- do not rely on old conversation text as the only durable store
- do not mix machine-local runtime/config state into the shared vault

## Notes on old terminology

You will still see older terms such as **page** and **node** in some docs, APIs, and tests.

The preferred user mental model is simpler:

- doc = durable markdown content
- skill = reusable workflow package
- instruction file = selected behavioral doc

## Related docs

- [Instruction Files, Docs, and Skills](./instructions-docs-skills.md)
- [Docs and Packages](./pages.md)
- [Conversation Context Attachments](./conversation-context.md)
- [Configuration](./configuration.md)
