---
id: 2026-03-13-tribunal-dd-source-readup
title: Tribunal dd-source read-up
type: note
kind: note
createdAt: 2026-03-13T16:58:00.000Z
updatedAt: 2026-03-13T16:58:00.000Z
---
# Tribunal dd-source read-up

## What Tribunal is in code
- Main engine: `domains/assistant/apps/evaluation/tribunal/tribunal.py`
- CLI entrypoint: `domains/assistant/apps/evaluation/tribunal/summon_tribunal.py`
- Experiment definitions: `domains/assistant/apps/evaluation/tribunal/assets/experiment_definitions.py`
- Judge registry: `domains/assistant/apps/evaluation/tribunal/judges/registry.py`

Tribunal runs experiments over sessions, applies judges (LLM-based or algorithmic), and can post outcomes to LLMObs evaluations.

## Data flow (source-backed)
1. **Find candidate sessions from LLMObs spans** via Retriever/Trino query (`repository/spans.py`).
2. **Apply org exclusions**:
   - customer restricted orgs from Snowflake (`repository/snowflake_client.py`)
   - hardcoded DD org exclusions (`repository/configs.py`)
3. **Load conversation content from chatstore** via `ReadOnlyDialogueManager.get_messages(...)` (`repository/sessions.py`).
4. Reconstruct turns and optional trace attachments by message id.

This confirms Tribunal is designed to respect customer data exclusion constraints before evaluating.

## Configurability relevant to our project
- **Ingestor granularity** (`core/ingestors.py`):
  - `IDENTITY` (whole session)
  - `TURNS` (per turn)
  - `PREFIXES` (cumulative up-to-turn)
- **Targeting filters**:
  - experiment-level `tool_allowlist` (only sessions/turns with specific tool calls)
  - judge-level `exclude_tools`, `exclude_system`, `user_messages_only`, `include_user_context`, `min_turns`, `reject_on_error`
  - experiment-level `skill_filter` + `skill_filter_mode` (`session` or `turn`)
- **Scoring types** (`core/definitions.py`): numerical, categorical, decision, text
- **Session aggregation** over per-turn judgments (e.g., OR or SUM with weights)
- **Judge dependency graph** via `run_when` (conditional execution based on upstream judge scores)

This aligns with our need to target semantic-search/tool-usage slices and distinguish categories of failures.

## Scheduling and cadence
- Cron job template: `evaluation/config/k8s/templates/cronjob-tribunal.yaml`
- Scheduled experiments list + explicit cron schedules: `evaluation/config/k8s/values.yaml`
- Existing scheduled Tribunal jobs run **twice daily** and default cron fallback is `0 9,21 * * *` if no schedule is set.
- Core taxonomy experiments use `trailing_days: 0.5` (12h lookback) in experiment definitions.

## Important implementation nuance
Adding an experiment to `assets/experiment_definitions.py` makes it runnable ad-hoc, but recurring production runs are controlled by the k8s values list (`tribunal.experiments`) and monitored cronjob list in Terraform (`tribunal_cronjob_failure_monitors.tf`).

## Implication for semantic-search eval kickoff
- We can start quickly by adding semantic-search judges/experiments in Tribunal and run ad-hoc.
- For production recurring runs, we should plan the extra wiring (values + monitors) once the judge stabilizes.
