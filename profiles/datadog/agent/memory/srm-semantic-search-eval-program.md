---
id: srm-semantic-search-eval-program
title: "SRM semantic search eval program"
summary: "Scope and initial workflow for Datadog SRM semantic-search evaluations using CMD+I Tribunal/chatstore infrastructure."
type: "project"
status: "active"
tags:
  - "datadog"
  - "srm"
  - "evals"
  - "semantic-search"
  - "tribunal"
  - "chatstore"
updated: 2026-03-13
---

# SRM semantic search eval program

High-signal notes for the Datadog SRM effort to evaluate semantic-search and tool-usage quality across agent surfaces.

## Current direction

- Start with the existing **CMD+I Tribunal + chatstore** workflow instead of building a net-new evaluation stack first.
- For CMD+I scouting, start from **LLM Obs `assistant_api` traces** and let Tribunal reconstruct the full chatstore session.
- Focus the first phase on **semantic search** and **tool/API usage quality** across surfaces, not on broad agent-quality scoring or skill-relevance evaluation.
- Prefer annotation of **online / production traces** for targeted issues; the current offline evals are useful background but too synthetic to be the primary signal.
- The initial scouting goal is to find **capability gaps** — cases where the agent lacks the right APIs, tools, or data sources to find what it needs — before optimizing narrower semantic-ranking behavior.
- Keep **Bits SRE out of the initial phase** until the workflow is proven on simpler surfaces.

## Working loop

- Start with a **small tool-filtered dataset pull** over the search/retrieval APIs most likely to matter for the current question, then manually review that sample before expanding scope.
- Review traces and taxonomy-style reports to identify concrete failure modes.
- Use the manual review to form concrete hypotheses first; add targeted **llm-as-judge** annotations only after the failure modes are clear enough to measure.
- Export online data into eval datasets, then hill-climb on the specific failure modes that show up.
- Reuse existing CMD+I dashboards and taxonomy work where they already fit the problem.

## Surface and data strategy

- Initial surfaces under discussion include **CMD+I**, **MCP**, and **NLQ**.
- A key gating question for each surface is where its conversational or trace data lives and whether it can flow through **chatstore / Tribunal** or needs equivalent tooling.
- If more agent surfaces can be represented through chatstore-compatible data, the evaluation workflow becomes much cheaper to extend.

## Evaluation framing

- Segment interactions by whether they are truly **semantic-search-related**.
- Measure whether an interaction was **successful**, with emphasis on finding the correct answer plus efficiency signals such as turns and tool calls.
- Distinguish issues caused by **intelligence/prompting** from issues caused by **API/tooling/discoverability/context**.
- For non-NLQ surfaces, use tool efficiency and smaller labeled datasets when exact ground truth is harder to define.

## Definition of done

- SRM can answer: **what are the most important failure modes and gaps to fix for each in-scope surface?**
- Evaluations run on a recurring basis and publish results automatically to dashboards.
