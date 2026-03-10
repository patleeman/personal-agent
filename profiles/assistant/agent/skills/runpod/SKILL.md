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
- CLI configured with an API key via `runpodctl config --apiKey ...`
- at least one SSH public key added to the Runpod account

Useful commands:

```bash
runpodctl version
runpodctl get cloud 1 --community
runpodctl get pod --allfields
runpodctl ssh list-keys
runpodctl ssh add-key --key-file ~/.ssh/id_ed25519.pub
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
   - re-check `runpodctl create pod --help` before assuming older examples still apply

## Current working create pattern

```bash
runpodctl create pod \
  --name <name> \
  --gpuType "NVIDIA GeForce RTX 4090" \
  --gpuCount 1 \
  --communityCloud \
  --imageName "runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04" \
  --containerDiskSize 30 \
  --volumeSize 50 \
  --volumePath /workspace \
  --ports 22/tcp \
  --ports 8888/http
```

## SSH and bootstrap

Inspect pod details with:

```bash
runpodctl get pod <pod-id> --allfields
```

For full SSH/SCP/SFTP access, the pod needs a public IP and TCP port 22 exposed. Official Runpod PyTorch images already have SSH configured.

Typical SSH form:

```bash
ssh root@<pod-ip> -p <ssh-port> -i <private-key-path>
```

Remote bootstrap pattern:
1. Start from an official PyTorch image.
2. Ensure public IP + TCP port 22 are enabled.
3. SSH in with the Runpod account key.
4. Bootstrap the box with `git`, `tmux`, `python3-venv`, and `build-essential`.
5. Clone the repo into `/workspace/<repo>`.
6. Create `.venv` and install dependencies.

## Operating rules

- Prefer **community cloud** for cheap bootstrap experiments.
- Put long runs inside **remote tmux**.
- Record the pod id, GPU type, hourly cost, SSH command, tmux session name, and training log path.
- Do not leave pods idling unnecessarily.
