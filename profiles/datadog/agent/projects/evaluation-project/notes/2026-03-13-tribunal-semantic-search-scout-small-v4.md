---
id: 2026-03-13-tribunal-semantic-search-scout-small-v4
title: Tribunal semantic-search scout small v4 results
kind: checkpoint
createdAt: 2026-03-13T18:13:30.000Z
updatedAt: 2026-03-13T18:13:30.000Z
---
# Tribunal semantic-search scout small v4 results

## Run details
- Run id: `run-tribunal-semantic-search-scout-small-v4-2026-03-13T18-08-14-025Z-ce273998`
- Status: completed
- Command: `bzl run //domains/assistant/apps/evaluation/tribunal:summon_tribunal -- --experiment semantic-search-scout-small --output-file /tmp/tribunal-semantic-search-scout-small-v4.json`
- Output file: `/tmp/tribunal-semantic-search-scout-small-v4.json`

## Dataset funnel observed in logs
- Initial session stubs: 420
- After excluded users: 401
- Loaded sessions: 3
- Session skips observed:
  - `unsupported_message_shape`: 398
  - `conversation_not_found`: 5

## Judge outcomes (small-sample scout)
- Executed sessions: 3
- `truncation_detected`: true in 2/3
- `implicit_approval` (turn-level): 7 neutral, 2 no (single session)
- `frustration`: avg 0.0 (single evaluated session)
- `is_candidate_ticket`: 0 true / 1 false
- `search_datadog_metrics_invalid_syntax`: 0 true / 1 false

## Early hypothesis signals
1. Tool-output truncation appears common in this small sample and is likely a useful failure-mode axis for semantic-search/tool-usage quality.
2. User disapproval appears in at least one session with truncation signals, suggesting truncation may contribute to perceived unhelpfulness.
3. Current scout prevalence numbers are not yet representative due to extreme ingestion attrition.

## Recommended next actions
- Investigate and normalize unsupported chatstore message shapes to recover session coverage.
- Rerun the scout after yield improvement (and/or with slightly wider lookback) to reach a more stable sample size.
- Promote truncation-related checks into the next round of targeted semantic-search failure judges.
