# Artifact Output Conventions

Use these conventions when the `artifact` tool is available.

## Recommended artifact set

### Primary artifact: HTML

Use `kind=html` for the main reader experience.
The HTML should be self-contained and readable in the artifact panel.

Recommended structure:

- title
- scope block
- executive summary
- ordered sections with headings
- focused code excerpts with file paths
- optional appendix

### Companion artifact: LaTeX source

Use `kind=latex` for the raw `.tex` source.
This should mirror the HTML document's section order closely enough that Patrick can copy or export it.

### Optional sidecar: Mermaid

Use `kind=mermaid` only when a standalone architecture or flow diagram meaningfully improves understanding.
Do not create diagram sidecars for trivial diagrams.

## Artifact id conventions

Prefer stable ids derived from the scope slug:

- `my-scope-litprog`
- `my-scope-litprog-tex`
- `my-scope-litprog-diagram`

Reuse the same ids on updates so the artifact thread stays stable.

## HTML guidance

Keep the HTML self-contained:

- inline CSS only
- no network dependencies unless the user explicitly asks for that tradeoff
- semantic headings and simple layout
- code excerpts inside `<pre><code>` blocks
- tables only when they actually clarify tradeoffs or mappings

For artifact styling, prefer a flat document layout:

- one main column
- spacing and typography for hierarchy
- avoid nested bordered panels
- avoid decorative chips/pills unless they carry meaning

## LaTeX guidance

The LaTeX artifact is source-first.
Use a standard article/report structure with:

- title
- scope section
- summary
- main sections
- verbatim or listings-style code excerpts
- appendix for large snippets

Do not try to force Mermaid rendering inside the LaTeX source unless the user specifically asks for that workflow.
If diagrams matter, use a Mermaid sidecar artifact and mention it in chat.

## Saving order

When producing more than one artifact, save them in this order:

1. HTML
2. LaTeX
3. Mermaid sidecar

That way the readable artifact opens first in the UI.

## Final chat response

After saving, respond briefly with:

- artifact ids and kinds
- what scope was covered
- any important caveats
- the next refinement you would make if asked
