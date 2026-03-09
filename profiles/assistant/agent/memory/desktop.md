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

## Stable access + identity

- SSH host alias: `desktop`
- Remote hostname: `patrick`
- Headless Ubuntu workstation (non-GUI default)

## Hardware summary

- CPU: AMD Ryzen 7 5800X3D
- RAM: 31 GiB
- GPU: NVIDIA GeForce RTX 3090 Ti with ~24 GB VRAM

## Environment notes

- OS observed: Ubuntu 24.04.2 LTS
- Core tools available: `git`, `tmux`, `python3`, `python3-venv`, `node`, `npm`
- Basic SSH / tmux / Python / Node workflows are ready without extra bootstrap

## Practical fit

Good fit for:

- local inference on small-to-mid models
- LoRA / QLoRA fine-tuning experiments
- single-GPU training and evaluation workflows
- CUDA-accelerated PyTorch work

Main constraints:

- larger full-finetuning jobs are VRAM-limited
- multi-GPU/distributed work is out of scope on current hardware
- containerized GPU workflows need Docker + NVIDIA container stack setup first

## Standard workflow

### Connect

```bash
ssh desktop
```

### Run long work in tmux

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

### Monitor machine state

```bash
nvidia-smi
watch -n 1 nvidia-smi
htop
free -h
```

### Python env baseline

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
systemctl get-default
```
