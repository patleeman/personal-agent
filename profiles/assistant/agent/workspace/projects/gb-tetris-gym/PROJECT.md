# gb-tetris-gym Project Notes

## Goal

Train a small model to control single-player Game Boy Tetris through the existing pi-boy mGBA bridge stack.

The current control formulation is:

- **streaming semantic state in** via `gbtap1`
- **short action chunk out** from `[lrabd.]`
- continuous tail-replacement execution in the emulator

## Key architecture decisions

### 1. Do not use tap-by-tap LLM calls as the main abstraction

Direct per-tap LLM control is too stale and too brittle.

Main lesson:

- latency that is unacceptable per tap can still be acceptable per short action chunk

### 2. `gbtap1` is the right current protocol shape

Important fields:

- board
- current piece
- x/y/rotation
- next piece
- level / lines / gravity
- optional queue tail

Important output alphabet:

- `l r a b d .`

### 3. Canonical runtime format and train target should be separated

Canonical protocol can remain:

- `O gbtap1 p=... t=... a=...`

But small chat-model training/inference works better when the model only emits:

- action chunk only, e.g. `arrddd`

The host can supply `p` and `t` bookkeeping itself.

## What was learned about small-model training

### 1. Data quality matters more than bigger GPUs right now

The hard part is not raw compute.
The hard part is getting the model the right state/action abstraction and good supervision.

### 2. Synthetic bootstrap data is acceptable as a first pass

Current bootstrap uses:

- synthetic boards
- lightweight placement teacher
- deterministic tap-plan slicer

This is good enough for a first trainable policy, but not good enough as the final dataset.

### 3. Real trajectory data is the next major unlock

After bootstrap, the dataset should come from:

1. emulator-recorded teacher traces
2. perturbed recovery traces
3. human demos

### 4. Small local chat models often echo structured prompts

Observed behavior:

- full `gbtap1` output lines were often echoed incorrectly by tiny models
- action-only outputs were much easier to elicit reliably

That means the practical training target should stay minimal.

### 5. First training target should be action chunks, not placement IDs

For this project’s current direction:

- train on **state -> next 1..8 actions**
- not raw tap IDs from old `gbtw1`
- not full future plans only

## Current repo state after this session

### Added / stabilized

- semantic RAM reader for gameplay state
- live `gbtap1` eval loop
- tail-replacement tap executor
- Runpod launcher/bootstrap tooling
- `gbtap1` bootstrap dataset generator
- `gbtap1` QLoRA trainer

### Current bootstrap training stack

- model: `Qwen/Qwen3.5-0.8B`
- objective: SFT over action-only `gbtap1` targets
- dataset file: `data/sft/gbtap1_actions_qwen35_08b_v1.jsonl`
- training script: `scripts/train_gbtap1_sft.py`

## Active remote training run from this session

Runpod pod used:

- pod id: `lafpdz6ugpkert`
- GPU: `RTX 3090`
- price seen: `~$0.22/hr`

Remote run details:

- tmux session: `gbtap1-train-20260307-234734`
- training log: `/workspace/gb-tetris-gym/artifacts/train/gbtap1-train-20260307-234734.log`
- output dir: `/workspace/gb-tetris-gym/artifacts/train/gbtap1-qwen35-08b-lora-v1`

## Practical lessons for future work

- Prefer 4090 first, but accept 3090 fallback if it gets the run started quickly
- Keep all long training runs in remote tmux
- Validate the trainer with a tiny smoke dataset before starting a multi-hour job
- Expect Transformers API drift; check exact installed signatures when failures happen
- Keep project docs updated whenever the data format or training path changes

## Next important steps

1. Let the current bootstrap run finish
2. Evaluate the trained adapter in the live `gbtap1` loop
3. Record emulator-generated teacher traces
4. Build a higher-quality dataset with recovery states
5. Add human demonstration recording
6. Retrain on the mixed real dataset
