---
name: runpod
description: Provision and manage short-lived Runpod GPU boxes. Use when Patrick wants burst GPU capacity, remote training boxes, or Runpod provisioning/cleanup help.
---

# Runpod

Use this skill for short-lived remote GPU boxes.

## When to use

- local desktop capacity is insufficient
- a clean remote GPU box is better for training or evaluation
- Patrick wants to inspect, stop, or delete Runpod pods

## Local prerequisites

- `runpodctl` installed locally
- `runpodctl doctor` should pass before automation
- expected checks:
  - API key configured
  - API connectivity passes
  - SSH key synced to the Runpod account

Useful commands:

```bash
runpodctl doctor
runpodctl gpu list
runpodctl pod list
runpodctl pod get <pod-id> --include-machine -o json
```

## Provisioning defaults

- Prefer **1x RTX 4090** in **Community Cloud** first.
- If 4090 allocation fails, fall back to:
  - `NVIDIA GeForce RTX 3090`
  - then `RTX A5000` / similar 24 GB class cards
- For bootstrap SFT on small models, 24 GB class GPUs are usually sufficient.
- Check live pricing and capacity right before provisioning.

## Common blockers

1. Low account balance
2. Machine capacity failure (`This machine does not have the resources to deploy your pod`)
3. `runpodctl` CLI syntax drift

## Current working create pattern

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

## SSH and bootstrap

Get connection details from:

```bash
runpodctl pod get <pod-id> --include-machine -o json
```

Look at the returned `ssh` object for:
- `ip`
- `port`
- `ssh_command`
- `ssh_key.path`

Remote bootstrap pattern:
1. Start from the official PyTorch image.
2. SSH in with the Runpod-managed key.
3. Bootstrap the box with `git`, `tmux`, `python3-venv`, and `build-essential`.
4. Clone the repo into `/workspace/<repo>`.
5. Create `.venv` and install dependencies.

## Operating rules

- Prefer **community cloud** for cheap bootstrap experiments.
- Put long runs inside **remote tmux**.
- Record the pod id, GPU type, hourly cost, SSH command, tmux session name, and training log path.
- Do not leave pods idling unnecessarily.

## Follow-up improvements worth making later

- add retry/fallback GPU logic to launcher scripts
- add pod stop/delete helpers
- add artifact sync-back helpers
- add HF auth bootstrap for faster model downloads/uploads
