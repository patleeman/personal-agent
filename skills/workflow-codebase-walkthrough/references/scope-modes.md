# Scope Modes

Every artifact run should choose a scope mode up front.

## 1. Whole repo

Use this when the user wants an onboarding or architecture overview.

### Default approach

- inspect manifests, top-level docs, and entry points first
- identify the core loop or primary product surface
- group supporting modules rather than dumping every file
- focus on the parts a new reader must understand first

### Required label

State clearly that the artifact is a **whole-repo overview**.
If the repo is large, say that lower-level modules are summarized rather than exhaustively covered.

## 2. Selected directories or files

Use this when the user points at a subsystem or area of ownership.

### Default approach

- treat the selected paths as the main subject
- mention upstream/downstream dependencies only as context
- explain boundaries with the rest of the repo
- include explicit file paths on excerpts

### Required label

State clearly that the artifact covers a **partial codebase scope** and name the paths.

## 3. Symbol or component

Use this for a single class, function family, API surface, job, or UI flow.

### Default approach

- center the document on one responsibility
- show call sites and collaborators around it
- keep the artifact tight and surgical

### Required label

State the exact symbol, route, job, or component that defines scope.

## 4. Diff / commit range / PR

Use this when the user wants a change review artifact.

### Default approach

1. inspect the diff summary first
2. read the changed files in context
3. identify behavior changes, not just line edits
4. explain intent, impact, and risk
5. mention untouched but affected components when relevant

### Bias for diff mode

Favor these sections:

- change summary
- motivation
- before vs after behavior
- key touched files
- correctness / risk notes
- follow-up questions

### Required label

State the exact diff basis if known, for example:

- `HEAD~3..HEAD`
- a commit SHA
- a PR branch comparison
- “unstaged working tree diff”

## 5. Mixed scope

Sometimes the user wants a diff explained in the context of a subsystem.
That is allowed.

In that case:

- state the primary scope and secondary context
- keep the narrative anchored on the change, not the entire repo

## Scope honesty rules

Always say:

- what was inspected
- what was intentionally left out
- whether the document is exhaustive or selective

Never imply:

- whole-repo completeness from a partial read
- runtime behavior you did not verify
- intent that is not grounded in the code or user prompt
