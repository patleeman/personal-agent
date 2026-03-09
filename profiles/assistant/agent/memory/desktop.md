---
id: desktop
title: Desktop Machine Notes
summary: Reference notes for Patrick's local Ubuntu GPU workstation and operating workflow.
type: reference
status: active
tags:
  - desktop
  - gpu
  - ubuntu
updated: 2026-03-09
---

# Desktop Machine Notes

## Purpose

Reference notes for Patrick's local headless Ubuntu GPU box (`desktop`) and how to use it for AI/dev workloads.

## Current machine snapshot (2026-03-07)

### Identity / access

- SSH host alias: `desktop`
- Remote hostname: `patrick`
- SSH is reachable and listening on port `22`
- Network addresses seen:
  - LAN: `192.168.1.100`
  - Tailscale: `100.93.52.88`

### OS / runtime

- OS: **Ubuntu 24.04.2 LTS (Noble)**
- Kernel: `6.14.0-24-generic`
- Boot target: `multi-user.target` (headless / non-GUI default)

### Compute hardware

- CPU: **AMD Ryzen 7 5800X3D** (8 cores / 16 threads)
- RAM: **31 GiB total**
- Swap: **8 GiB**
- GPU: **NVIDIA GeForce RTX 3090 Ti**
  - VRAM: **24,564 MiB (~24 GB)**
  - Driver: **575.51.03**
  - Reported CUDA version: **12.9**

### Storage

- Root filesystem: `/dev/sdb2` (ext4), ~`938G` total, ~`680G` free at snapshot time
- Additional disks present:
  - `sda` ~`1.8T` (NTFS, TOSHIBA HDD)
  - `nvme0n1` ~`953.9G` (INTEL NVMe, NTFS partitions present)

### Tooling currently installed

- Present: `git`, `tmux`, `python3` (3.12.3), `python3-venv`, `node` (v18.19.1), `npm` (9.2.0)
- Not currently installed: `docker`, `docker-compose`, `uv`, `pnpm`, `conda/mamba`, `pipx`

## Practical capabilities (3090 Ti + 24 GB VRAM)

Good fit for:

- Local inference for 7B/8B/14B-class models (quantized)
- QLoRA/LoRA fine-tuning on small-to-mid models
- Single-GPU training experiments and evaluation loops
- CUDA-accelerated PyTorch workflows

Likely constraints:

- Full fine-tuning of larger models will be VRAM-limited
- Multi-GPU/distributed workloads are out of scope unless hardware changes
- Containerized GPU workflows need Docker + NVIDIA container stack setup first

## How to use it (standard workflow)

### 1) Connect

```bash
ssh desktop
```

### 2) Start long work in tmux

```bash
tmux new -s <session-name>
# run training / inference job
# detach: Ctrl-b d
```

Reattach later:

```bash
tmux ls
tmux attach -t <session-name>
```

### 3) Monitor GPU/compute state

```bash
nvidia-smi
watch -n 1 nvidia-smi
htop
free -h
```

### 4) Python env baseline

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
```

## Quick verification commands

```bash
hostnamectl
cat /etc/os-release
nvidia-smi -L
nvidia-smi
df -h /
systemctl get-default
```

## Recommended next setup improvements

1. Install Docker + NVIDIA Container Toolkit (if containerized ML workflows are desired).
2. Install `uv` (or `pipx`) for faster Python tooling management.
3. Add a standard workspace directory convention (e.g., `~/work/<repo>`).
4. Add lightweight monitoring aliases/scripts (`gpu`, `gpumon`, `disk`, `mem`).
5. Record preferred backup/sync policy for model artifacts and checkpoints.
