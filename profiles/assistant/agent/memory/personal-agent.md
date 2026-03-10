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
updated: 2026-03-10
---

# personal-agent Project Notes

## Current interface direction

- Keep `pa tui` as one Pi TUI instance per terminal tab.
- Do not assume a tmux-managed workspace or pane UI is active; that frontend experiment was intentionally rolled back.
- Use tmux for background orchestration, not as the main user-facing window manager.

## Gateway scope

- Discord support was intentionally removed because Patrick does not use it.
- Telegram gateway and daemon tasks remain first-class surfaces.

## Revisit gate

- A richer workbench-style TUI may be revisited later, but it is not the current direction.
- Do not reintroduce multi-pane/tab workbench UX or revive the shelved no-tmux/desktop plan without a fresh user decision.
