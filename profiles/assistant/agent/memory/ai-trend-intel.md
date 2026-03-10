---
id: ai-trend-intel
title: AI Trend Intel — Project Context
summary: Project brief and operating constraints for the AI trend intelligence pipeline.
type: project
status: active
tags:
  - ai
  - trends
  - pipeline
updated: 2026-03-10
---

# AI Trend Intel — Project Context

## Repository

- Path: `/Users/patrick/workingdir/ai-trend-intel`

## Objective

Build and operate a local-first, low-cost AI news trend pipeline.

## Core Constraints

1. **Local-first always**: build and validate locally before Unraid deployment.
2. **Deterministic first**: trend conclusions come from stored metrics, not per-article LLM summaries.
3. **Cost guardrails**: no paid API dependency required; embeddings optional and off by default.
4. **Citations required**: every reported trend includes source URLs.

## Standard Workflow

1. Scope source list + taxonomy.
2. Ingest + normalize feed items.
3. Compute deterministic trend metrics (volume, velocity, persistence, source spread).
4. Generate daily ranked markdown report with citations.
5. Validate via tests + deterministic rerun checks.
6. Deploy to Unraid only after explicit approval.

## Related memory docs

- Local-first runbook: `profiles/assistant/agent/memory/ai-trend-intel-local-first.md`
