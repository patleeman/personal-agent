---
name: pa-project-hub
description: Manage personal-agent durable projects as cross-conversation work hubs. Use when creating or updating PROJECT.yaml, BRIEF.md, project notes, or project file resources, or when deciding which project fields are mutable versus derived.
---

# Personal-agent project hub

Projects are durable cross-conversation work hubs.

Use this skill when the user wants to:

- create a project manually
- update `PROJECT.yaml`
- edit `BRIEF.md`
- add or update project notes
- inspect project file layout
- decide whether something belongs in project state, notes, files, or runtime-only links

## Core model

A project lives under:

- `~/.local/state/personal-agent/profiles/<profile>/agent/projects/<projectId>/PROJECT.yaml`
- `~/.local/state/personal-agent/profiles/<profile>/agent/projects/<projectId>/BRIEF.md`
- `~/.local/state/personal-agent/profiles/<profile>/agent/projects/<projectId>/notes/`
- `~/.local/state/personal-agent/profiles/<profile>/agent/projects/<projectId>/attachments/`
- `~/.local/state/personal-agent/profiles/<profile>/agent/projects/<projectId>/artifacts/`

`PROJECT.yaml` is the canonical structured record.

`BRIEF.md` is the durable high-signal brief.

Notes are markdown files in `notes/`.

Attachments and artifacts are file-entry directories.

## What is mutable

Mutate directly:

- `PROJECT.yaml`
- `BRIEF.md`
- note files in `notes/*.md`
- file-entry contents under `attachments/` or `artifacts/` when needed

Do **not** try to directly edit derived UI state such as:

- linked conversation lists
- timeline entries
- note/file counts
- attachment/artifact counts

Those are derived from files or local runtime state.

## Portability rule

Never store conversation ids or session ids in `PROJECT.yaml`, `BRIEF.md`, or note frontmatter.

Conversation ↔ project links live in local runtime state.

Use the `project` tool only for current-conversation reference or unreference operations.

## `PROJECT.yaml` rules

Projects start lightweight.

- milestones are optional
- `currentMilestoneId` is optional
- tasks may omit `milestoneId`
- new projects should not be seeded with default milestones
- quote YAML list items when they contain `:` and you intend them to stay plain strings

Keep these fields current when useful:

- `summary`
- `status`
- `currentFocus`
- `blockers`
- `recentProgress`

Prefer concise, durable text over verbose logs.

## Minimal project scaffold

When creating a project manually:

1. create the project directory
2. create `notes/`, `attachments/`, and `artifacts/`
3. write `PROJECT.yaml`
4. create `BRIEF.md` only if the user asked for it or there is enough signal to write one now

A minimal `PROJECT.yaml` looks like this:

```yaml
id: example-project
createdAt: 2026-03-13T12:00:00.000Z
updatedAt: 2026-03-13T12:00:00.000Z
title: Example project
description: What the project is about.
summary: Project created. Capture the brief, notes, and next steps as the work takes shape.
status: created
blockers: []
currentFocus: Capture the goal and first next step.
recentProgress: []
plan:
  milestones: []
  tasks: []
```

## Notes format

Each note is markdown with YAML frontmatter:

```md
---
id: design-decision
title: Design decision
kind: decision
createdAt: 2026-03-13T12:00:00.000Z
updatedAt: 2026-03-13T12:00:00.000Z
---
Keep projects as the cross-conversation hub.
```

Common note kinds:

- `note`
- `decision`
- `question`
- `meeting`
- `checkpoint`

## File-entry format

Attachments and artifacts are stored as entry directories:

- `attachments/<fileId>/metadata.json`
- `attachments/<fileId>/blob`
- `artifacts/<fileId>/metadata.json`
- `artifacts/<fileId>/blob`

`metadata.json` shape:

```json
{
  "id": "kickoff-notes",
  "title": "Kickoff notes",
  "description": "Optional description",
  "originalName": "kickoff.txt",
  "mimeType": "text/plain",
  "createdAt": "2026-03-13T12:00:00.000Z",
  "updatedAt": "2026-03-13T12:00:00.000Z"
}
```

Prefer the web UI/API for uploaded binary files.
Only hand-author these entries when the user explicitly wants file-level manipulation and you can safely create the blob.

## Recommended workflow

When asked to make durable project changes:

1. inspect the existing project files first
2. update only the files that need changing
3. keep `summary`, `currentFocus`, and `recentProgress` high signal
4. keep briefs concise and restart-friendly
5. add notes for decisions or accumulated context
6. leave derived state alone
7. validate `PROJECT.yaml` before finishing with `node scripts/validate-projects.mjs --profile <profile> --project <projectId>` (or `--path <absolute-path-to-PROJECT.yaml>` for a one-off file check)
8. use the `project` tool only when you need to reference or unreference the project in the active conversation

## Inspection checklist

When inspecting a project, check in this order:

1. `PROJECT.yaml`
2. `BRIEF.md` if present
3. recent notes in `notes/`
4. attachment/artifact metadata when relevant

## Good defaults

- Prefer milestone-less projects unless phases add real value.
- Prefer unassigned tasks over fake placeholder milestones.
- Prefer notes for accumulating context and decisions.
- Prefer the brief for the current handoff story.
- Prefer `recentProgress` for short durable bullets, not meeting transcripts.
