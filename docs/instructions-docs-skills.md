# Instruction Files, Docs, and Skills

This is the durable content model `personal-agent` should optimize around.

The short version is:

- **instruction files** shape agent behavior because they are selected locally
- **docs** are the default durable knowledge unit
- **skills** are the only special shared folder contract

## The real primitive is a file-backed doc

The knowledge base should be a directory of markdown docs and doc packages.

A doc can live anywhere in the vault. It does not become special because of a folder name.

Good examples:

```text
~/Documents/personal-agent/
├── skills/
├── work/
├── systems/
├── people/
├── ideas/
└── references/
```

That means there is no required `notes/` or `projects/` folder in the shared vault contract.

Those can still exist as conventions, migrations, or UI views, but they are not the core model.

## Instruction files

Instruction files are markdown docs that shape behavior because the operator selected them in local config or Settings.

They are not special because of a magic path or filename.

Common examples:

- `~/Documents/personal-agent/instructions/base.md`
- `~/Documents/personal-agent/work/datadog-guidelines.md`
- `~/Documents/personal-agent/AGENTS.md`

`AGENTS.md` is still a useful convention and external harness compatibility point, but it is not the durable KB contract by itself.

The important rule is:

> a file is an instruction file because it is selected, not because it is named `AGENTS.md`

## Docs

Docs are the normal durable knowledge layer.

A doc can be:

- a single markdown file such as `systems/runtime-model.md`
- a doc package such as `systems/runtime-model/INDEX.md` with supporting files nearby

Docs can carry frontmatter metadata like:

- `title`
- `summary`
- `tags`
- `kind`
- `status`

That metadata should drive UI filters and views, not filesystem law.

If a doc wants to present itself as a project, reference, brief, or design note, that should come from metadata and relationships.

## Skills

Skills remain special because they have real runtime semantics.

The shared skill contract is:

```text
skills/<skill>/SKILL.md
```

A skill package can also include supporting files such as:

- `references/`
- `scripts/`
- `examples/`

Use a skill when the content answers:

> how should the agent perform this workflow again later?

## No vault profiles

Profiles should not be modeled as durable KB folders.

Behavior selection belongs in machine-local config:

- `instructionFiles[]`
- `skillDirs[]`
- model/runtime settings
- provider auth and machine-local defaults

The shared vault should stay about portable docs and skills, not profile plumbing.

## Conversations and docs

Conversations should work with docs in two ways:

- **one-shot mention** via `@path-or-id` for the current turn
- **persistent attachment** when a doc should stay attached to the conversation across turns

That keeps the model simple:

- the vault stores the docs
- the conversation stores references to selected docs
- the prompt builder decides how much of each doc to inject

## Practical rules

1. Default to ordinary docs in the vault.
2. Use `skills/` only for reusable workflow packages.
3. Treat instruction files as selected docs, not a separate vault hierarchy.
4. Do not encode behavior or context semantics in folder names when a selection or attachment model is clearer.
5. Keep machine-local runtime/config state out of the shared vault.

## Related docs

- [Knowledge Management System](./knowledge-system.md)
- [Docs and Packages](./pages.md)
- [Conversations](./conversations.md)
- [Conversation Context Attachments](./conversation-context.md)
- [Configuration](./configuration.md)
