---
id: gb-tetris-gym
title: gb-tetris-gym Project Notes
summary: Project memory for model-training architecture and current direction on gb-tetris-gym.
type: project
status: active
tags:
  - gb-tetris-gym
  - ml
  - tetris
updated: 2026-03-09
---

# gb-tetris-gym Project Notes

## Goal

Train a small model to control single-player Game Boy Tetris through the existing pi-boy mGBA bridge stack.

The current control formulation is:

- semantic gameplay state in via `gbtap1`
- short action chunk out from `[lrabd.]`
- continuous tail-replacement execution in the emulator

## Key architecture decisions

### 1. Do not use tap-by-tap LLM calls as the main abstraction

Direct per-tap LLM control is too stale and too brittle.

Main lesson:

- per-tap latency is unacceptable, but short action chunks are viable

### 2. `gbtap1` is the right current protocol shape

Important state fields:

- board
- current piece
- x/y/rotation
- next piece
- level / lines / gravity
- optional queue tail

Important output alphabet:

- `l r a b d .`

### 3. Canonical runtime format and train target should be separated

Canonical protocol can remain structured, but model training and inference work better when the model emits only the action chunk.

Practical target:

- train on `state -> next 1..8 actions`
- keep host-side bookkeeping outside the model output

## Lessons learned

### Data and targets matter more than raw compute right now

- the main bottleneck is getting the state/action abstraction and supervision right
- action-only targets are more reliable than asking tiny models to emit full structured `gbtap1` lines

### Synthetic bootstrap data is acceptable, but not the end state

Current bootstrap data uses:

- synthetic boards
- lightweight placement teacher
- deterministic tap-plan slicer

Next useful data sources are:

1. emulator-recorded teacher traces
2. perturbed recovery traces
3. human demos

## Current working stack

The repo now has end-to-end infrastructure for:

- semantic RAM reading and live `gbtap1` evaluation
- tail-replacement tap execution
- bootstrap dataset generation
- QLoRA / SFT training
- emulator-backed spawn-state corpora
- teacher-trace recording
- PPO rollout/loss scaffolding
- `train_gbtap1_rl.py` with BC-anchor support

Current bootstrap training setup:

- model: `Qwen/Qwen3.5-0.8B`
- objective: SFT over action-only `gbtap1` targets
- dataset file: `data/sft/gbtap1_actions_qwen35_08b_v1.jsonl`
- training script: `scripts/train_gbtap1_sft.py`

## Current status

- bootstrap SFT completed and the resulting adapter can be loaded locally on the desktop 3090 Ti
- local desktop eval plumbing works end-to-end, including the Linux memory bridge and `--backend local-peft`
- teacher-trace recording is smoke-tested on desktop
- first mixed adapter and first PPO run completed end-to-end, but still clear `0` lines

Current likely bottleneck:

- data alignment, not emulator plumbing
- earlier teacher data only supervised the first chunk of each piece, while live play often needs continuation chunks on the same piece
- continuation-aware chunked-teacher tooling is now implemented

## Practical guidance for future work

- prefer 4090 first, but 24 GB-class GPUs are adequate for bootstrap runs
- keep long training runs in remote tmux
- validate trainers with tiny smoke datasets before multi-hour runs
- expect Transformers API drift and check installed signatures when failures appear
- keep project docs updated when the data format or training path changes

## Next important steps

1. Finish the continuation-aware dataset build
2. Retrain the continuation-aware mixed adapter
3. Evaluate continuation-aware results against bootstrap and mixed-v1
4. Run BC-anchored PPO from the continuation-aware adapter
5. Compare live behavior across bootstrap vs mixed-v1 vs continuation-aware vs PPO+BC
6. Add recovery states
7. Add human demonstration recording
