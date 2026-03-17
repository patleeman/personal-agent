---
id: personal-agent
title: "personal-agent Project Notes"
summary: "Current project direction and UX constraints for the personal-agent repo."
type: "project"
status: "active"
tags:
  - "personal-agent"
  - "tui"
  - "gateway"
updated: 2026-03-17
---

# personal-agent Project Notes

## Current interface direction

- Keep `pa tui` as one Pi TUI instance per terminal tab.
- Do not assume a tmux-managed workspace or pane UI is active; that frontend experiment was intentionally rolled back.
- Use tmux for background orchestration, not as the main user-facing window manager.
- Ongoing workbench-style UX experimentation is in the web UI, not in a richer Pi TUI shell.

## Web conversation UX constraints

- Keep conversation-header metadata compact and low-noise: prefer plain text over pill badges, keep model/thinking/context on one row when practical, and avoid redundant manual resume controls when send already auto-resumes the session.
- Transcript and context UI must be compaction-aware but durable-history-first: derive context usage from the effective current context, render history from the full persisted session log rather than a truncated live context window, and show compaction summaries inline instead of silently dropping earlier chat.
- Treat the chat scrollbar as a quiet right-edge conversation rail that preserves transcript width and makes user turns more prominent landmarks than assistant turns.
- In the right rail/workstream UI, prefer a single focused workstream card with inline remove controls over nested pill-plus-box chrome, and let conversation-scoped runs be inspectable from that rail with rich status/log detail.
- Fork/branch behavior should preserve conversation lineage; branching from an assistant message should not prefill or auto-send the preceding user prompt.
- Persistent user settings that should survive restarts belong in profile/local settings overlays, not ephemeral runtime state rebuilt at startup.

## Gateway scope

- Discord support was intentionally removed because Patrick does not use it.
- Telegram gateway and daemon tasks remain first-class surfaces.

## Revisit gate

- A richer workbench-style TUI may be revisited later, but it is not the current direction.
- Do not reintroduce multi-pane/tab workbench UX or revive the shelved no-tmux/desktop plan without a fresh user decision.
