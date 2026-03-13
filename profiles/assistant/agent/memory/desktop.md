---
id: desktop
title: Desktop Machine Notes
summary: Reference facts for Patrick's local Ubuntu GPU workstation and when to prefer it over remote compute.
type: reference
status: active
tags:
  - desktop
  - gpu
  - ubuntu
updated: 2026-03-13
---

# Desktop Machine Notes

## Identity

- SSH host alias: `desktop`
- Remote hostname / user context: `patrick`
- Headless Ubuntu workstation used for local AI and development workloads

## Hardware summary

- CPU: AMD Ryzen 7 5800X3D
- RAM: 31 GiB
- GPU: NVIDIA GeForce RTX 3090 Ti with ~24 GB VRAM

## Environment notes

- OS observed: Ubuntu 24.04.2 LTS
- Core tools available: `git`, `tmux`, `python3`, `python3-venv`, `node`, `npm`
- Basic SSH, tmux, Python, and Node workflows are ready without extra bootstrap

## Practical fit

Prefer `desktop` for:

- local inference on small-to-mid models
- LoRA / QLoRA fine-tuning experiments
- single-GPU training and evaluation workflows
- CUDA-accelerated PyTorch work

Main constraints:

- larger full-finetuning jobs are VRAM-limited
- multi-GPU or distributed work is out of scope on current hardware
- containerized GPU workflows still need Docker + NVIDIA container stack setup first

## Working rule

- Use `desktop` before renting remote GPUs when local capacity is sufficient.
- Put long-running jobs in `tmux`.
- Escalate to Runpod only when local capacity or isolation is not enough.
