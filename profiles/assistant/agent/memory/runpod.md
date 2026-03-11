---
id: runpod
title: Runpod Usage Notes
summary: Patrick uses Runpod for burst GPU capacity beyond the local desktop; the operational provisioning workflow lives in the assistant Runpod skill.
type: reference
status: active
tags:
  - runpod
  - gpu
  - infra
updated: 2026-03-10
---

# Runpod Usage Notes

Use Runpod when the local desktop is not enough or when a clean short-lived remote GPU box is preferable.

## Decision rule

- prefer the local desktop when it is sufficient
- use Runpod for burst GPU capacity or a clean disposable environment

## Workflow location

Detailed provisioning, fallback GPU selection, tmux usage, and cleanup rules live in `profiles/assistant/agent/skills/runpod/SKILL.md`.
