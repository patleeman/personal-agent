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

## Durable preferences

- prefer community-cloud RTX 4090 first
- 24 GB-class fallbacks such as 3090 / A5000 are acceptable for bootstrap SFT
- keep long runs inside remote tmux
- do not leave pods idling

## Workflow location

Operational Runpod workflow lives in `profiles/assistant/agent/skills/runpod/SKILL.md`.
