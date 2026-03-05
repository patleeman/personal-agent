# Profile Workspace

This directory stores **profile-local project context** that is not a reusable skill.

Use this for:
- project briefs
- runbooks
- implementation notes
- specs and checklists

## Layout

```text
workspace/
  projects/
    <project-slug>/
      PROJECT.md
      runbooks/
      specs/
      notes/
```

## Rules

1. Keep reusable, cross-project workflows in `skills/`.
2. Keep project-specific state and runbooks here.
3. Never store secrets or credentials.
4. Prefer one canonical `PROJECT.md` per project.
