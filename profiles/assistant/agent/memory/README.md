---
id: memory-overview
title: Profile Memory Overview
summary: Conventions for storing profile-local memory docs in a flat markdown directory.
type: reference
status: active
tags:
  - memory
  - profile
  - conventions
updated: 2026-03-09
---

# Profile Memory Overview

This directory stores **profile-local memory docs** that are not reusable skills.

Use this directory for:
- project briefs
- runbooks
- implementation notes
- checklists

## Flat layout

- Keep memory docs as `memory/*.md` (single folder, no nested project tree).
- Every memory doc must include YAML frontmatter with:
  - `id`, `title`, `summary`, `tags`, `updated`
  - optional `type`, `status`
- Use `pa memory list`, `pa memory find`, `pa memory show`, `pa memory new`, and `pa memory lint` for retrieval, creation, and validation.
- Do not maintain a separate manual catalog; rely on frontmatter plus the `pa memory` commands for discovery.

## Rules

1. Keep reusable, cross-project workflows in `skills/`.
2. Keep profile-local context in memory docs with clear frontmatter.
3. Prefer durable, high-signal notes over transient run logs or session chatter.
4. Keep non-markdown automation state outside `memory/` (for example `agent/state/...`).
5. Scheduled daemon task files belong in sibling `../tasks/` (not inside `memory/`).
6. Never store secrets or credentials.
