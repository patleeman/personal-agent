---
id: runpod
title: Runpod Usage Notes
summary: Decision note for when Patrick should use Runpod instead of the local desktop.
type: reference
status: active
tags:
  - runpod
  - gpu
  - infra
updated: 2026-03-13
---

# Runpod Usage Notes

## Decision rule

- Prefer the local desktop when it has enough capacity.
- Use Runpod for burst GPU capacity or a clean disposable environment.

## Workflow location

- Detailed provisioning, fallback GPU selection, tmux usage, and cleanup rules live in `profiles/assistant/agent/skills/runpod/SKILL.md`.
