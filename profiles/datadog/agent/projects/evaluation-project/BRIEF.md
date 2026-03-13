# Evaluation Project Brief

## Objective
Build a recurring evaluation program that identifies the highest-impact **semantic-search/tool-usage** failure modes across agent surfaces (starting with CMD+I), and publishes actionable results to dashboards.

## Current strategy
1. Start fast with **CMD+I + Tribunal + chatstore**.
2. Build a semantic-search-focused taxonomy and LLM-as-judge annotations.
3. Run both ad-hoc historical analysis and ongoing online analysis.
4. Use exported online eval data to hill-climb on specific tool/API issues.
5. Expand to other surfaces once data integration is clear.

## Key decisions (Mar 13, 2026 sync)
- Scope is tool/API usage quality for semantic search (efficiency, coverage, discoverability), not full agent behavior taxonomy.
- Reuse CMD+I framework where possible (Tribunal + taxonomy report pipeline).
- **BitsSRE is deferred for now** to reduce startup complexity.
- Start from traces, form hypotheses, regroup.

## Latest execution snapshot (Mar 13, 2026)
- Ran first live small-sample Tribunal scout (`semantic-search-scout-small`) against `assistant_api` traces (org 2).
- Current run output exists at `/tmp/tribunal-semantic-search-scout-small-v4.json`.
- Runtime funnel for this pass: 420 initial stubs -> 401 after excluded users -> 3 loaded sessions.
- Early hypothesis signal is high tool-output truncation incidence (flagged in 2/3 executed sessions).
- Data quality blocker surfaced: very high session skip rate due unsupported chatstore message shape, which limits representativeness.

## In scope
- Semantic-search interaction detection and triage.
- Success/failure labeling and root-cause split:
  - intelligence/model/prompt side
  - API/tool side (our primary focus)
- Cross-surface dataset path (CMD+I, MCP, NLQ) once data sources are confirmed.
- Recurring dashboards and SRM-ready gap reports.

## Out of scope (for now)
- Skill relevance evaluation (owned by other teams).
- Full taxonomy coverage beyond semantic search.
- Immediate BitsSRE integration.

## Workstreams / owners
- **System integration:** Nicolas Hivon
- **Data engineering:** Anisha Chatterjee
- **Evaluation pipeline:** Patrick Lee
- **Metrics and analysis:** Ibrahim Ridene

## Definition of done
SRM can answer: “What are the most important failure modes and gaps to fix in each surface (CMD, MCP, NLQ)?”

And:
- Evals run on a regular cadence.
- Results auto-populate dashboards.

## Immediate next steps
- Validate and address unsupported chatstore message shapes so scout runs retain more sessions.
- Rerun the scout with a slightly wider sample window once ingestion yield is improved.
- Convert scout output into a shortlist of semantic-search/tool-usage hypotheses with rough prevalence bands.
- Finalize Tribunal filters/rubric for semantic-search interactions based on the shortlist.
- Confirm data source ownership for MCP/NLQ.
