---
name: workflow-litprog-artifact
description: Generate literate-programming-style code walkthrough artifacts from a whole repo, selected paths, or a git diff. Use when the user wants an onboarding document, architecture explainer, change review, or narrative technical report delivered as a web UI artifact instead of plain chat prose.
---

# Literate Programming Artifact

Adapt the spirit of [tlehman/litprog-skill](https://github.com/tlehman/litprog-skill) to `personal-agent` artifact output.

The goal is **not** to make a `.lit.md` file the source of truth.
The goal **is** to produce a reader-first technical document that explains a codebase, subsystem, or diff in psychological order and save it as an artifact when possible.

## What to Produce

When the `artifact` tool is available, prefer this output set:

1. **Primary readable artifact**
   - Usually `kind=html`
   - Self-contained, readable in the web UI
   - Includes title, scope, narrative sections, code excerpts, and optional tables

2. **Companion LaTeX source artifact**
   - `kind=latex`
   - Raw LaTeX source for copy/export/editing
   - Mirrors the section structure of the readable artifact

3. **Optional Mermaid sidecar**
   - `kind=mermaid`
   - Use only when a standalone architecture or flow diagram materially helps

Use stable artifact ids when iterating, for example:

- `<slug>-litprog`
- `<slug>-litprog-tex`
- `<slug>-litprog-diagram`

If the user explicitly wants **source only**, skip the HTML companion and save only the LaTeX artifact.
If the `artifact` tool is unavailable, return the LaTeX inline or write a `*.tex` file only if the user asks for file output.

## Scope First

Before drafting, lock the scope into one of these modes:

- whole repo
- selected directories
- selected files
- symbol or subsystem
- diff / commit range / PR

Always state the scope near the top of the document.
If the scope is partial or diff-based, label it clearly as partial coverage. Do **not** imply whole-repo completeness.

See `references/scope-modes.md`.

## Core Workflow

### 1. Confirm the target

Identify:

- repo root or referenced project
- requested scope
- audience and goal
  - onboarding
  - architecture overview
  - review artifact
  - change explanation
  - handoff notes

If the scope is vague but still workable, make a sensible assumption and label it.
Only interrupt for clarification when the ambiguity would make the document misleading.

### 2. Inspect before writing

Use normal repo inspection tools to understand the scoped area:

- manifests and entry points
- public APIs
- data flow
- background loops or async work
- important types and state transitions
- external systems and config surfaces

See `references/analysis-workflow.md`.

### 3. Choose a narrative order

Pick the order that is easiest to understand:

- **top-down** for layered systems
- **data-centric** for pipelines and schemas
- **request-lifecycle** for services and handlers
- **change-centric** for diffs and refactors

The narrative order does not need to match file order.

### 4. Outline before drafting

Draft a section plan before writing the final artifact.
A good default outline is:

1. title + scope
2. executive summary
3. architecture or change overview
4. main flows
5. key modules and why they exist
6. risks, tradeoffs, or follow-ups
7. appendix with focused code excerpts

### 5. Write prose before code

Each code excerpt must be motivated first.
For every excerpt:

- say why it matters
- include the file path
- keep it scoped and readable
- avoid giant dumps when a focused slice will do

Do not invent missing lines.
Do not paraphrase code inside a quoted excerpt.

### 6. Save artifacts

When the `artifact` tool is available:

- save the readable HTML artifact first
- save the companion LaTeX artifact second
- add a Mermaid artifact only when it carries real explanatory value
- reuse the same artifact ids on later revisions

See `references/artifact-output.md` and `assets/codebase-walkthrough.tex`.

### 7. Finish with a concise chat summary

After saving artifacts, tell the user:

- which artifacts were saved
- what scope they cover
- any important omissions or uncertainty
- suggested next iteration, if useful

## Document Guidance

### For whole-repo or subsystem docs

Focus on:

- entry points
- core data flow
- major abstractions
- background processes
- important dependencies
- notable design choices and constraints

### For diff or PR docs

Bias toward:

- what changed
- why it changed
- behavioral impact
- migration or compatibility implications
- testing and risk hotspots
- follow-up work the diff suggests

### For partial path docs

Explicitly call out:

- what is in scope
- what neighboring modules are referenced but not fully covered
- where the reader should look next

## Quality Bar

Before saving the artifact, check:

- scope is explicit
- narrative order is intentional
- prose appears before each code excerpt
- code excerpts are accurate and attributed
- claims match the inspected code
- the document is useful to a reader unfamiliar with the area
- the final artifact is shorter than a full repo dump and more useful than a plain summary

## References

- `references/analysis-workflow.md`
- `references/scope-modes.md`
- `references/artifact-output.md`
- `assets/codebase-walkthrough.tex`
