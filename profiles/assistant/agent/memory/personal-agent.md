---
id: personal-agent
title: "personal-agent Project Notes"
summary: "Current project direction, UX constraints, and core model notes for the personal-agent repo."
type: "project"
status: "active"
tags:
  - "personal-agent"
  - "tui"
  - "gateway"
updated: 2026-03-10
---

# personal-agent Project Notes

## Current interface direction

- Keep `pa tui` as one Pi TUI instance per terminal tab.
- Do not assume a tmux-managed workspace or pane UI is active; that frontend experiment was intentionally rolled back.
- Use tmux for background orchestration, not as the main user-facing window manager.
- Ongoing workbench-style UX experimentation is in the web UI, not in a richer Pi TUI shell.

## Web conversation UX constraints

- Keep conversation-header metadata compact and low-noise: prefer plain text over pill badges, keep model/thinking/context on one row when practical, and avoid redundant manual resume controls when send already auto-resumes the session.
- Context-usage UI and any breakdowns must be compaction-aware: derive from the effective current context, never from lifetime totals or the full transcript.
- Treat the chat scrollbar as a quiet right-edge conversation rail that preserves transcript width and makes user turns more prominent landmarks than assistant turns.
- In the right rail/workstream UI, prefer a single focused workstream card with inline remove controls over nested pill-plus-box chrome.

## Gateway scope

- Discord support was intentionally removed because Patrick does not use it.
- Telegram gateway and daemon tasks remain first-class surfaces.

## Core model direction

- Treat `personal-agent` as one personal agent for Patrick, not a general multi-user product.
- Profiles are domain/context boundaries layered on top of a shared agent identity; in practice, each machine usually has one dominant active profile.
- New conversations should start from durable profile memory (`AGENTS.md`, skills, memory docs), not from blank transcript state.
- Tasks should be first-class, profile-scoped objects that can start in one surface, run elsewhere, and later be resumed or checked from another surface.
- Portability should prioritize syncing durable memory/configuration and task summaries or metadata across machines over raw chat history.

## Inspectability and context reduction

- Keep the full conversation or execution trail inspectable when Patrick needs to drill in.
- Also maintain compact summaries that expose durable facts, progress, blockers, decisions, artifacts, and next actions without reloading the full transcript.
- Treat inspectability as a core trust requirement, not only a debugging aid.

## Revisit gate

- A richer workbench-style TUI may be revisited later, but it is not the current direction.
- Do not reintroduce multi-pane/tab workbench UX or revive the shelved no-tmux/desktop plan without a fresh user decision.
