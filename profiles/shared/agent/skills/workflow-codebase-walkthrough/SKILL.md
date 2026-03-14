---
name: workflow-codebase-walkthrough
description: Generate maintainer-focused codebase walkthrough artifacts as concise HTML reports with architecture diagrams and selective code excerpts. Use for architecture overviews, onboarding documents, subsystem explainers, and diff walkthroughs.
---

# Codebase Walkthrough Report

Produce a **reader-first technical report** that helps Patrick or another maintainer quickly understand a codebase or subsystem.

The goal is **not** to produce a source-first document.
The goal **is** to create a concise walkthrough that answers:

- what this code is for
- what path to understand first
- what decisions shape the design
- what is easy to miss
- where to start editing

The output should read like a short internal white paper or architecture report, not like a website, dashboard, or file inventory.

For styling, use `https://latex.vercel.app/` as the default visual reference.

## Default Output

When the `artifact` tool is available, prefer this set:

1. **Primary HTML report artifact**
   - `kind=html`
   - fully self-contained by default
   - optimized for reading in the artifact panel
   - use the visual language of LaTeX.css / `https://latex.vercel.app/`
   - do not depend on remote stylesheet or font URLs in the final artifact
   - prefer the bundled `assets/report-template.html`, which already inlines the vendored styling stack

2. **Mermaid diagram sidecar**
   - `kind=mermaid`
   - strongly recommended for whole-repo and subsystem walkthroughs
   - show the main components, state boundaries, and core flow

Use stable artifact ids, for example:

- `<slug>-walkthrough-html`
- `<slug>-walkthrough-diagram`

Default to HTML, plus Mermaid when a diagram materially helps.

Do **not** generate LaTeX unless Patrick explicitly asks for it.

If the `artifact` tool is unavailable, return the report inline or write files only if the user asks.

## Editorial Stance

The artifact should read like onboarding notes from a senior engineer.

### Optimize for comprehension first

The goal is not to sound clever.
The goal is to help a maintainer understand the code quickly.

Prefer:

- plain language
- short paragraphs
- one concrete path before abstractions
- explicit consequences
- readable section titles
- concise prose

Avoid:

- compressed architecture-essay prose
- rhetorical contrast for its own sake
- category dumps
- file-by-file tours
- filler phrases

### Write for a new or returning maintainer

Assume the reader is smart, but new to this area.

A good report lets them answer:

- What is this area for?
- What should I trace first?
- What state does it read or write?
- What is easy to break?
- If I need to change behavior X, where do I start?

### Headings should help navigation

Prefer headings that make the subject obvious.

Good:

- `System at a glance`
- `What happens when you send a prompt`
- `How scheduled tasks become daemon runs`
- `Where runtime state lives`
- `Where to edit`

Claim-based headings are allowed, but only when they are clearer than direct headings.

### Diagrams are first-class

For whole-repo and subsystem reports, include one compact architecture diagram by default.

The diagram should show:

- major components
- durable vs local state boundaries
- the main execution path
- important external/runtime dependencies

Keep diagrams focused:

- 5–12 nodes
- one main flow
- readable in one screen

### File paths are evidence, not prose

Use file paths sparingly:

- once in the scope statement
- in snippet captions
- in a `Where to edit` section
- in an appendix only if needed

Do **not** repeat file paths in every paragraph.

### Snippets must explain why they matter

Include only a few snippets.

For each snippet:

1. say why it matters
2. show only the relevant excerpt
3. explain the maintenance consequence

Good snippet purposes:

- a branching decision
- a state ownership boundary
- a recovery hinge
- a non-obvious transformation
- a failure-mode branch
- a load-bearing helper

Avoid snippets that only prove:

- a type exists
- a constant exists
- a wrapper forwards arguments
- a module imports another module

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

## Default Report Structure

Use this order unless the scope strongly suggests otherwise:

1. **Title + scope + audience**
2. **Abstract / executive summary**
3. **Architecture diagram**
4. **The first path to understand**
5. **Main components or package responsibilities**
6. **Interesting code worth reading**
7. **What is easy to miss**
8. **Where to edit**
9. **Caveats / omissions**

For substantial reports, include 2–6 snippets.

## Core Workflow

### 1. Confirm scope, audience, and question

Identify:

- repo root or referenced project
- scope mode
- audience and goal
- the main question the report will answer

Examples of a main question:

- `What path should a new maintainer understand first?`
- `How does this subsystem actually work end to end?`
- `What changed behaviorally in this diff?`

### 2. Find the spine before outlining

Inspect the code and identify:

- the core loop or happy path
- the main pressure on the design
- the two or three load-bearing decisions
- what is subtle or easy to break
- what can be omitted safely

See `references/analysis-workflow.md`.

### 3. Outline in maintainer order

Do not default to a file-by-file walk.
Choose the order that makes the system easiest to understand.

Default order:

1. what this area is for
2. how the main path works
3. which pieces matter most
4. which code is worth reading closely
5. what is easy to miss
6. where to edit

### 4. Choose evidence, not coverage

Select only a few excerpts.
Each excerpt should support a point already made in prose.
If a snippet does not deepen understanding, cut it.

### 5. Write the report

When drafting:

- lead with the clearest mental model
- use direct headings
- explain consequences, not just responsibilities
- keep the prose concise
- prefer readability over density
- keep the main column focused on explanation

### 6. Save artifacts

When the `artifact` tool is available:

- save the HTML report first
- save a Mermaid sidecar when helpful
- reuse the same artifact ids on revisions
- use the `artifact` tool itself rather than ad hoc files when artifact output is available

See `references/artifact-output.md` and `assets/report-template.html`.
The template asset is the canonical self-contained LaTeX.css-style reference for this skill.
If `assets/latex.css` or the font assets change, regenerate the template with `scripts/build_inline_template.py` before producing artifacts.

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
- the handful of modules that matter most
- where to edit when behavior needs to change

### Diff or PR

Bias toward:

- the behavioral change, not the file list
- the motivation or pressure behind the change
- what became simpler, safer, riskier, or more explicit
- regressions or edge cases to watch
- follow-up work suggested by the diff

### Partial path docs

Bias toward:

- what is in scope
- what is only referenced as context
- what the reader should inspect next for neighboring details

## HTML Style Rules

The HTML should use **LaTeX.css / `https://latex.vercel.app/` as the default styling reference**.

Use the bundled inline template as the default starting point.
Copy the upstream CSS and any required font assets into local assets, then inline them into the final artifact.
Assume the artifact panel will not serve sibling repo files for you.
Do not rely on remote stylesheet or font URLs unless Patrick explicitly asks for that tradeoff.

Prefer structure that is compatible with that template, for example:

- centered title
- small-caps author/date line
- centered abstract block
- `nav.toc` contents section when useful
- one reading column
- `article.indent-pars` for paragraph rhythm when it reads well
- figure captions and listing captions
- restrained colors and sparse ornament
- section numbering when it helps

Prefer a **fully inline HTML artifact** so it still renders correctly without network access and without any sibling asset files being served.
Use `assets/report-template.html` directly unless you have a good reason to diverge.
If the upstream CSS source changes, regenerate that inline template from the vendored assets rather than linking out at render time.

Avoid:

- dashboard chrome
- app-like navigation
- heavy card grids as the main layout
- decorative pills/chips
- website landing-page aesthetics
- faux paper-card wrappers when the simpler LaTeX.css document layout is sufficient

The report should look closer to an arXiv-style technical note than to a product marketing page.

## Quality Bar

Before saving, check:

- the report is easy to follow on a first read
- the main path is explained before abstractions pile up
- the diagram clarifies the architecture
- snippets include why they matter and what they imply
- the report helps a maintainer decide where to look next
- the prose is concise and calm
- the result is more useful than a code tour and easier to read than an architecture essay

## References

- `references/analysis-workflow.md`
- `references/scope-modes.md`
- `references/artifact-output.md`
- `assets/latex.css`
- `assets/report-template.html`
- `scripts/build_inline_template.py`
