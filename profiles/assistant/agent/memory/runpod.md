---
id: runpod
title: Runpod Notes
summary: Reusable operational notes for provisioning and managing short-lived Runpod GPU boxes.
type: reference
status: active
tags:
  - runpod
  - gpu
  - infra
updated: 2026-03-09
---

# Runpod Notes

## Purpose

Reusable workspace notes for provisioning short-lived GPU training boxes from the assistant.

## Current Working Setup

### Local prerequisites

- `runpodctl` installed locally via Homebrew
- `runpodctl doctor` should pass before any automation
- Expected checks:
  - API key configured
  - API connectivity passes
  - SSH key synced to Runpod account

Useful commands:

```bash
runpodctl doctor
runpodctl gpu list
runpodctl pod list
runpodctl pod get <pod-id> --include-machine -o json
```

## Pod provisioning lessons

### Good default for early model training

- Start with **1x RTX 4090** in **Community Cloud** when available
- If 4090 allocation fails due to machine capacity, fall back to:
  - `NVIDIA GeForce RTX 3090`
  - then `RTX A5000` / similar 24 GB class cards
- For bootstrap SFT on small models, 24 GB class GPUs are enough

### Cost intuition

- Community-cloud pricing and capacity fluctuate; check current rates and availability right before provisioning.
- Expect RTX 4090 capacity to be spikier and typically pricier than 3090 / A5000-class fallbacks.

### Common blockers

1. **Low account balance**
   - Runpod creation fails immediately with a clear error
2. **Machine capacity failure**
   - `This machine does not have the resources to deploy your pod`
   - Usually solved by retrying or using a nearby fallback GPU
3. **CLI syntax drift**
   - `runpodctl` changed between old and new command styles
   - Current working pattern is `runpodctl pod create ...`

## Current working create pattern

The current `runpodctl` command shape that has worked reliably:

```bash
runpodctl pod create \
  --name <name> \
  --gpu-id 'NVIDIA GeForce RTX 4090' \
  --gpu-count 1 \
  --cloud-type COMMUNITY \
  --image 'runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04' \
  --container-disk-in-gb 30 \
  --volume-in-gb 50 \
  --volume-mount-path /workspace \
  --ports '22/tcp,8888/http' \
  --public-ip \
  --ssh \
  -o json
```

## SSH / connection notes

Runpod exposes SSH details in:

```bash
runpodctl pod get <pod-id> --include-machine -o json
```

Look at the returned `ssh` object:

- `ip`
- `port`
- `ssh_command`
- `ssh_key.path`

This was the most reliable way to get connection info.

## Remote bootstrap pattern

Working remote bootstrap approach:

1. Start from official PyTorch image
2. SSH in with Runpod-managed key from `runpodctl`
3. Run a bootstrap script that:
   - installs `git`, `tmux`, `python3-venv`, `build-essential`
   - clones the repo into `/workspace/<repo>`
   - creates `.venv`
   - installs project + training dependencies
   - writes a small env helper script for later shells

## Operational guidance

- Prefer **community cloud** for cheap bootstrap experiments
- Prefer **secure cloud** only when stability or specific hardware matters more than cost
- Do not leave pods idling unnecessarily
- Put long runs inside **remote tmux**
- Record:
  - pod id
  - GPU type
  - hourly cost
  - SSH command
  - tmux session name
  - training log path

## Follow-up improvements worth making later

- Add retry/fallback GPU logic directly into launcher script
- Add pod stop/delete helpers to the launcher
- Add artifact sync-back helper for trained adapters
- Add HF auth bootstrap for faster model downloads/uploads
