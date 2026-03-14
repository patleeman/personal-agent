# Artifact Output Conventions

Use these conventions when the `artifact` tool is available.

## Recommended artifact set

### Primary artifact: HTML report

Use `kind=html` for the main walkthrough.
This is the default and preferred output.

The HTML should be:

- fully self-contained by default
- easy to read in the artifact panel
- styled in the visual language of LaTeX.css / `https://latex.vercel.app/`
- optimized for maintainers, not for website-like presentation

Prefer the bundled `assets/report-template.html` as the default starting point.
If the exact upstream look matters, copy both the stylesheet and the required font assets from the repo into local assets and inline them into the generated HTML.
Do not assume the artifact panel will serve sibling files such as `latex.css` or `fonts/*.woff2`.

Recommended report shape:

1. title
2. scope statement
3. abstract / executive summary
4. architecture diagram
5. first path to understand
6. main components or package map
7. interesting code excerpts
8. what is easy to miss
9. where to edit
10. caveats / omissions

### Optional sidecar: Mermaid

Use `kind=mermaid` when one focused diagram materially improves understanding.

Prefer one compact diagram over a sprawling one.
For whole-repo and subsystem walkthroughs, a Mermaid sidecar is usually worth adding.

## Artifact id conventions

Prefer stable ids derived from the scope slug:

- `my-scope-walkthrough-html`
- `my-scope-walkthrough-diagram`

Reuse the same ids on updates so the artifact thread stays stable.

## Editorial rules

### Write for maintainers

The report should help a new or returning maintainer answer:

- what this code is for
- what path to trace first
- what state it reads or writes
- what is easy to break
- where to edit

### Readability beats density

Prefer:

- plain language
- short paragraphs
- direct headings
- one concrete path before abstractions
- selective evidence

Avoid:

- compressed architecture-essay prose
- file-by-file tours
- decorative or app-like HTML layouts
- category dumps with no point of view

### Paths as evidence

Use file paths in:

- the scope section
- excerpt labels
- evidence notes
- the final `Where to edit` section
- an appendix only if needed

Avoid path-heavy body prose unless the path itself is the point.

### Snippet selection

Snippets should prove something.
For each snippet:

1. explain why it matters
2. show a short excerpt
3. explain the maintenance consequence

Prefer snippets showing:

- branching logic
- state boundaries
- recovery or failure-mode logic
- non-obvious transformations
- API seams that change behavior

Avoid low-signal snippets that only show type declarations, constants, or trivial wrappers.

## HTML guidance

Keep the HTML self-contained by default:

- inline CSS preferred
- inline any required font data as well
- vendor the LaTeX.css stylesheet locally when using that look
- no network dependencies unless the user explicitly asks for that tradeoff
- one main reading column
- LaTeX.css-like typography and spacing
- code excerpts inside `<pre><code>` blocks
- figure and listing captions when helpful
- `author`, `abstract`, and `toc` patterns when they improve readability

For layout, prefer a short internal paper.
Think:

- LaTeX.css / `https://latex.vercel.app/`
- arXiv-style report
- internal architecture memo
- white paper

Not:

- website landing page
- dashboard
- app UI mockup

See `assets/report-template.html` for the default inline template.
If the vendored source assets change, regenerate that file with `scripts/build_inline_template.py`.

## Saving order

When producing more than one artifact, save them in this order:

1. HTML
2. Mermaid sidecar

## Final chat response

After saving, respond briefly with:

- artifact ids and kinds
- what scope was covered
- the main angle or thesis of the report
- any important caveats
- the next refinement you would make if asked
