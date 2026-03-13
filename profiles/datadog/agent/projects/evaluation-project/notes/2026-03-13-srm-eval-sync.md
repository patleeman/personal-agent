---
id: 2026-03-13-srm-eval-sync
title: SRM Eval Project Sync — 2026-03-13
kind: meeting
createdAt: 2026-03-13T16:50:00.000Z
updatedAt: 2026-03-13T16:50:00.000Z
---
# SRM Eval Project Sync — 2026-03-13

Attendees: Patrick Lee, Ibrahim Ridene, Nicolas Hivon, Anisha Chatterjee, Clément Poirier

## Context captured
- Tribunal is a strong mechanism for live trace annotation with configurable LLM-as-judge logic.
- Tribunal can extract chats from chatstore while respecting constraints (e.g., customer AI exclusion list).
- Supports targeted annotations (tool calls, user messages, etc.) and ad-hoc large-scale historical analysis.
- Current cadence includes ad-hoc runs and twice-daily runs with 12h lookback.
- CMD+I offline evals are synthetic; recommendation is to rely on targeted online annotations for concrete issues.

## Current direction
- Reuse CMD+I framework (Tribunal/chatstore/taxonomy report) rather than building from scratch.
- Position project around semantic-search/tool-usage quality across surfaces.
- Start with CMD+I data and trace triage to generate hypotheses and prevalence.

## In scope
- Tool usage quality and API-side behavior (efficiency, coverage, discoverability).
- Semantic-search-focused taxonomy.
- Cross-surface applicability (CMD+I, MCP, NLQ) once data integration is clear.

## Out of scope (for now)
- Skill relevance quality.
- Full agent-level regression taxonomy.
- Immediate BitsSRE integration.

## Open questions
- Which agents/surfaces are in scope beyond CMD+I first pass?
- Where does each surface’s data live?
- If outside chatstore, replicate workflow vs migrate data into chatstore?
- How to align with teams running independent eval workflows?

## Owners / workstreams
- System integration: Nicolas Hivon
- Data engineering: Anisha Chatterjee
- Evaluation pipeline: Patrick Lee
- Metrics and analysis: Ibrahim Ridene

## Action items
- [All] Inspect traces and form hypotheses.
- [Clément] Review decision framing.
