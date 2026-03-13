# Artifact Output Conventions

Use these conventions when the `artifact` tool is available.

## Recommended artifact set

### Primary artifact: LaTeX source

Use `kind=latex` for the canonical litprog report.
This should usually be a full document, not a fragment.

Recommended report shape:

- title
- scope statement
- one-paragraph thesis
- the path to understand first
- the decisions that shape everything else
- what is easy to miss
- where to edit / start changing behavior
- appendix with evidence snippets

### Companion artifact: HTML

For substantial walkthroughs, also save a rendered `kind=html` companion.
This should be the easiest version to read in the artifact panel.
The HTML may be written directly or compiled from the same LaTeX/report content.

### Optional sidecar: Mermaid

Use `kind=mermaid` only when one focused diagram materially improves understanding.
Prefer one clear diagram over an exhaustive one.

## Artifact id conventions

Prefer stable ids derived from the scope slug:

- `my-scope-litprog-tex`
- `my-scope-litprog-html`
- `my-scope-litprog-diagram`

Reuse the same ids on updates so the artifact thread stays stable.

## Editorial rules

### Claims over catalogues

The report should not read like:

- file A does X
- file B does Y
- file C does Z

Instead, organize around:

- what the subsystem is trying to guarantee
- which decisions create the observed behavior
- what is surprising or fragile
- where a maintainer should intervene

### Paths as evidence

Use file paths in:

- the scope section
- excerpt labels
- evidence notes
- the final `Where to edit` section
- the appendix

Avoid path-heavy body prose unless the location itself is the key point.

### Snippet selection

Snippets should prove claims.
Prefer snippets showing:

- branching logic
- revision or ordering rules
- data ownership boundaries
- error handling or fallback behavior
- API seams or classification logic

Avoid low-signal snippets that merely show constant declarations, type aliases, or obvious wrappers.

## HTML guidance

Keep the HTML self-contained:

- inline CSS only
- no network dependencies unless the user explicitly asks for that tradeoff
- one main reading column
- strong typography and spacing
- code excerpts inside `<pre><code>` blocks
- callouts only when they add clarity

For layout, prefer a clean reading experience over decorative chrome.

## LaTeX guidance

Use a standard article/report structure with:

- `\documentclass`
- only the packages you need
- strong section titles that make claims
- short, motivated excerpts
- appendix for supporting evidence

Do not overload the main body with raw file paths.
Do not require PDF generation to make the artifact useful.
LaTeX is the canonical source; HTML is the rendered reading companion.

## Saving order

When producing more than one artifact, save them in this order:

1. LaTeX
2. HTML
3. Mermaid sidecar

That keeps the source canonical while still surfacing the rendered reader companion.

## Final chat response

After saving, respond briefly with:

- artifact ids and kinds
- what scope was covered
- the main angle or thesis of the report
- any important caveats
- the next refinement you would make if asked
