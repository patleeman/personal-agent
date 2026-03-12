---
id: personal-agent-durable-background-runs
title: "Personal-agent durable background runs"
summary: "Canonical product direction for replacing tmux-backed local background work with daemon-backed durable runs and restart recovery."
type: "project"
status: "active"
tags:
  - "personal-agent"
  - "background-runs"
  - "daemon"
  - "restart-recovery"
  - "tmux"
updated: 2026-03-12
---

# Personal-agent durable background runs

High-signal product guidance for local background execution and restart recovery.

## Core direction

- Replace tmux as the first-class local orchestration path with daemon-backed durable runs.
- Scheduled or detached background work should be inspectable through durable run state, logs, and results rather than tmux session management.
- Web-triggered background work and live conversations should converge on the same restart-recoverable model over time.

## Restart recovery contract

- "Survive restarts" means recover from durable state after a process restart, not keep the original worker process alive.
- Recovery should happen from explicit durable boundaries such as manifests, status, journals, output, results, and checkpoints.
- Recovery policy should be defined per run kind, for example `continue`, `rerun`, or `manual`.

## V1 boundaries

- Do not promise exact mid-token continuation.
- Do not promise exact mid-command continuation for arbitrary shell commands.
- Do not assume exactly-once tool execution.
- Prefer honest resumable workflows built around durable checkpoints and inspectable recovery state.
