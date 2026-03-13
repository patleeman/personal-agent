---
name: workflow-litprog-artifact
description: Generate literate-programming-style walkthrough artifacts from a whole repo, selected paths, or a git diff. Use when the user wants an onboarding document, architecture explainer, change review, or technical report delivered as a high-signal artifact rather than plain chat prose.
---

# Literate Programming Artifact

Adapt the spirit of [tlehman/litprog-skill](https://github.com/tlehman/litprog-skill) to `personal-agent` artifact output.

The goal is **not** to make a `.lit.md` file the source of truth.
The goal **is** to produce a reader-first technical document that helps Patrick understand:

- what this area is really doing
- which decisions shape it
- what is easy to miss
- where to start if he needs to change it

## Default Output

When the `artifact` tool is available, prefer this set:

1. **Primary LaTeX report artifact**
   - `kind=latex`
   - full-document LaTeX source
   - structured as a real report, not a formula fragment

2. **Rendered HTML companion**
   - `kind=html`
   - strongly preferred for substantial reports because it is easier to read in the artifact panel
   - can be written directly or compiled from the same LaTeX/report content

3. **Optional Mermaid sidecar**
   - `kind=mermaid`
   - only when one diagram materially clarifies the core loop, architecture, or state change

Use stable artifact ids, for example:

- `<slug>-litprog-tex`
- `<slug>-litprog-html`
- `<slug>-litprog-diagram`

Default to LaTeX + HTML for substantial walkthroughs.
If the user explicitly wants source only, save only the LaTeX artifact.
If the `artifact` tool is unavailable, return the report inline or write files only if the user asks.

## Editorial Stance

The artifact should feel like an explanation, not an inventory.

### Optimize for insight density

The document should answer questions like:

- What problem is this code solving?
- Why is it shaped this way?
- Which two or three decisions matter most?
- What would a maintainer likely misunderstand on first read?
- If I want to change behavior X, where do I start?

### Use claims, not categories

Prefer section titles that make an argument.

Good:

- `The real boundary is conversation scope, not rendering`
- `The server adds binding, not much business logic`
- `Full LaTeX documents are classified before they are rendered`

Weak:

- `Architecture Overview`
- `Key Modules`
- `Persistence Model`

### File paths are evidence, not prose

Do **not** turn the artifact into a file tour.
Use file paths sparingly:

- once in the scope statement
- in excerpt captions or evidence notes
- in a final `Where to edit` / `Start here` section
- in the appendix

Avoid repeating file paths in every paragraph unless the path itself is the point.

### Snippets must earn their place

Include only snippets that reveal one of these:

- an invariant
- a boundary
- a branching decision
- a failure mode
- a load-bearing data transformation
- a non-obvious tradeoff

Do **not** include snippets that merely prove a constant exists, a type exists, or a wrapper forwards arguments unless that is the key behavioral hinge.

### Sound like a person with a point of view

The prose should be calm and precise, but not lifeless.
Avoid report filler and managerial phrasing.

Weak phrases unless followed by a concrete consequence:

- `is the source of truth`
- `translation layer`
- `intentionally layered`
- `this is important because`
- `handles X, Y, and Z`

If you use one of those, immediately explain the consequence for behavior, maintenance, or change risk.

## Scope First

Before drafting, lock the run into one of these modes:

- whole repo
- selected directories
- selected files
- symbol or subsystem
- diff / commit range / PR

Always state the scope near the top.
If the scope is partial or diff-based, label it clearly as selective coverage.
Do **not** imply whole-repo completeness from a narrow read.

See `references/scope-modes.md`.

## Core Workflow

### 1. Confirm scope, audience, and question

Identify:

- repo root or referenced project
- scope mode
- audience and goal
- the main question this document will answer

Examples of a main question:

- `What is the one path a new maintainer should understand first?`
- `What really changed in this diff, behaviorally?`
- `Why does this subsystem feel simple from the outside?`

### 2. Find the spine before outlining

Inspect the code and identify:

- the core loop or happy path
- the main pressure or constraint on the design
- the two or three load-bearing decisions
- what is surprising, subtle, or easy to break
- what can be safely omitted

See `references/analysis-workflow.md`.

### 3. Outline in psychological order

Do not default to a file-by-file walk.
Choose the order that makes the system easiest to understand.
A good default shape is:

1. title + scope
2. one-paragraph thesis
3. the path to understand first
4. the decisions that shape everything else
5. what is easy to miss
6. where to edit if you need to change behavior
7. appendix with evidence snippets

### 4. Choose evidence, not coverage

Select only a few excerpts.
Each excerpt should prove a claim already made in prose.
Lead with the claim, then show the code.
If a snippet does not deepen understanding, cut it.

### 5. Write the artifact

When drafting:

- lead with the most useful mental model, not a taxonomy
- prefer claim-based headings
- explain consequences, not just responsibilities
- keep file paths mostly in evidence notes and the final change map
- keep the appendix subordinate to the narrative

### 6. Save artifacts

When the `artifact` tool is available:

- save the primary LaTeX artifact first
- save the HTML companion for substantial reports unless Patrick asked for source only
- add a Mermaid sidecar only when it materially helps
- reuse the same artifact ids on revisions
- use the `artifact` tool itself rather than ad hoc files when artifact output is available

See `references/artifact-output.md` and `assets/codebase-walkthrough.tex`.

### 7. Finish with a concise chat summary

After saving artifacts, tell Patrick:

- which artifacts were saved
- what scope they cover
- the main angle of the report
- any important omissions or uncertainty
- the next refinement you would make if asked

## Guidance by Scope Type

### Whole repo or subsystem

Bias toward:

- what this area is fundamentally for
- the path to understand first
- the design pressures that explain the shape of the code
- the handful of modules that actually matter
- what to change first if behavior needs to move

### Diff or PR

Bias toward:

- the behavioral change, not the file list
- the motivation or pressure behind the change
- what became simpler, safer, riskier, or more explicit
- regressions or edge cases to watch
- follow-up work the diff suggests

### Partial path docs

Bias toward:

- what is in scope
- what is only referenced as context
- what the reader should inspect next if they want the neighboring details

## Quality Bar

Before saving, check:

- the report makes a clear point, not just a summary
- headings make claims instead of naming buckets
- snippets prove claims instead of padding coverage
- file paths support the narrative instead of crowding it
- the document helps a maintainer decide where to look next
- the report is selective enough to stay readable
- the output is more useful than a code tour and more grounded than a vague essay

## References

- `references/analysis-workflow.md`
- `references/scope-modes.md`
- `references/artifact-output.md`
- `assets/codebase-walkthrough.tex`
