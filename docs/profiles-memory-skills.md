# Profiles, AGENTS, Pages, and Skills

Profiles are how `personal-agent` changes behavior, prompting, defaults, and available resources around the shared durable vault.

A profile is not just a label. It is a layered resource bundle.

## Layer order

Resources resolve in this order:

1. repo defaults from `defaults/agent`
2. vault profile files from `~/Documents/personal-agent/_profiles/<profile>/`
3. machine-local overlay from `~/.local/state/personal-agent/config/local`
4. repo built-ins from `extensions/`, `themes/`, and `prompt-catalog/`

## What a profile can contain

The durable vault can contain:

- `_profiles/<profile>/AGENTS.md`
- `_profiles/<profile>/settings.json`
- `_profiles/<profile>/models.json`
- `_skills/**`
- `notes/**`
- `projects/**`

Scheduled tasks are separate: they stay under the machine-local state root instead of the shared vault.

## Vault layout

```text
~/Documents/personal-agent/
├── _profiles/
│   └── <profile>/
│       ├── AGENTS.md
│       ├── settings.json
│       └── models.json
├── _skills/
├── notes/
└── projects/
```

## What each piece is for

| Path | Purpose |
| --- | --- |
| `_profiles/<profile>/AGENTS.md` | durable behavior and standing instructions |
| `_profiles/<profile>/settings.json` | profile-specific defaults such as themes and interface/model prefs |
| `_profiles/<profile>/models.json` | model provider definitions and overrides |
| `_skills/<skill>/SKILL.md` | reusable workflow procedures |
| `notes/**` | reusable durable knowledge |
| `projects/**` | tracked work with durable state |

## Local overlay

The local overlay defaults to:

```text
~/.local/state/personal-agent/config/local
```

Use it for machine-local tweaks that should not live in the shared vault.

Typical uses:

- local `AGENTS.md` additions
- local settings or models overrides
- machine-local extensions, prompts, themes, or skills

## Skills

Skill pages are reusable procedures, not profile settings.

Use a skill when the content answers:

> how should we do this workflow again later?

Keep the skill self-contained and practical. Supporting files such as `references/` or `scripts/` are fine inside the skill package.

## Notes and tracked pages

Notes, skills, and tracked pages all live in the same vault, but they do different jobs:

- note page = reusable knowledge
- skill page = reusable procedure
- tracked page = active work with durable execution state

## Profile selection

The selected default profile is machine-local and stored in `~/.local/state/personal-agent/config/config.json`.

You can inspect or change it with:

```bash
pa profile list
pa profile show
pa profile use <name>
```

## Package installs

`pa install` writes package sources into either:

- the active profile settings
- the local overlay settings

That is how profile-specific or machine-local external Pi packages are added without editing repo defaults.

## Related docs

- [Knowledge Management System](./knowledge-system.md)
- [Pages](./pages.md)
- [Tracked Pages](./projects.md)
- [Command-Line Guide (`pa`)](./command-line.md)
