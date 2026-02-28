# Profile Schema

This document describes the **resource profile** schema used by `@personal-agent/resources`.

## Directory schema

A profile is a directory under `profiles/<name>/agent`.

Required baseline:

- `profiles/shared/agent` must exist

Optional overlays:

- `profiles/<name>/agent` (for example `profiles/datadog/agent`)
- local overlay directory (default `~/.config/personal-agent/local`)

## Supported files and directories

Inside each `agent/` layer:

- `settings.json` (optional)
- `models.json` (optional)
- `AGENTS.md` (optional)
- `SYSTEM.md` (optional)
- `APPEND_SYSTEM.md` (optional)
- `extensions/` (optional)
- `skills/` (optional)
- `prompts/` (optional)
- `themes/` (optional)

## Layer precedence

Merge order is deterministic:

1. `shared`
2. selected profile overlay
3. local overlay

Higher layers override lower layers.

## Merge semantics

### JSON files (`settings.json`, `models.json`)

- object keys are merged recursively
- arrays are replaced by higher layer arrays
- scalar values are replaced by higher layer values

### Markdown files

- `AGENTS.md`: all existing layers are concatenated (shared → overlay → local)
- `APPEND_SYSTEM.md`: all existing layers are concatenated in same order
- `SYSTEM.md`: highest-precedence existing file wins (local > overlay > shared)

## Discovery semantics

For each resolved layer:

- `skills/` directories are collected and passed as `--skill <dir>`
- extension entry files are discovered from `extensions/` (`*.ts`, `*.js`, or `<name>/index.ts|js`)
- prompt templates are discovered as markdown files under `prompts/`
- themes are discovered as json files under `themes/`
- deduplication is path-based, preserving first-seen order

## Validation rules

- `shared` profile must exist or resolution fails
- selected profile must exist when explicitly requested (except `shared`)
- local overlay is optional and only included when directory exists
- non-existent optional files are ignored
