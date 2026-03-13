# Codebase Analysis Workflow

Use this before drafting the artifact.
The goal is not to collect every fact.
The goal is to find the facts that give the document a spine.

## 1. Find the real entry surface

Locate where execution, public use, or external pressure begins.
Common places:

| Ecosystem | Typical entry surfaces |
| --- | --- |
| Node / Bun | `package.json`, CLI bins, server bootstrap files |
| Python | `__main__.py`, CLI modules, app factories |
| Go | `func main()` |
| Rust | `src/main.rs` or exported library surface |
| Web apps | router setup, page entry files, server bootstrap |
| Libraries | exported modules, public interfaces, primary types |

For libraries, start from the public API, not an imaginary runtime path.

## 2. Identify the pressure on the design

Ask what force shaped this code.
Examples:

- request/response boundaries
- persistence and data ownership
- async/background coordination
- compatibility constraints
- UI responsiveness
- correctness or safety requirements
- operational simplicity

A good report usually gets stronger once this pressure is named explicitly.

## 3. Trace the path to understand first

Starting from the entry surface, follow the one path that best explains the system:

1. what input arrives
2. what transformation or decision matters most
3. what state changes or side effects occur
4. what output leaves the system

Useful questions:

- Where does behavior actually change?
- Where are invariants enforced?
- Where do errors or fallbacks appear?
- Which object or type crosses multiple stages?

This path usually becomes the narrative spine.

## 4. Find the load-bearing decisions

Look for the two or three decisions that shape everything else.
These are often:

- a classification branch
- a persistence boundary
- a schema or id choice
- a retry/recovery rule
- a division between thin glue and real business logic
- a caching or ownership rule

If you can explain those decisions clearly, you often do not need to summarize every file.

## 5. Find what is easy to miss

Look for things a maintainer might overlook on a first read:

- hidden coupling
- revision or ordering semantics
- scope boundaries
- default behavior that feels surprising
- UI behavior driven by a tiny helper
- code that looks generic but is actually the behavioral hinge

This is where the most valuable commentary often lives.

## 6. Decide what to omit

If the scope is too large for a useful artifact:

- focus on the core loop
- focus on the touched subsystem
- collapse repetitive neighbors into one sentence
- push low-value details into the appendix
- say what you intentionally left out

A sharp partial document beats a bloated “complete” one.

## 7. Capture evidence while inspecting

Keep notes on:

- files inspected
- exact excerpts worth quoting
- key functions, types, or branches
- unresolved questions
- claims that need grounding in code

Use paths as evidence and navigation aids, not as the main prose style.

## 8. Draft the thesis before drafting sections

Before writing the report, force these three prompts:

1. **What is this area really doing?**
2. **Which decisions shape it most?**
3. **Where should a maintainer start if they need to change it?**

If you cannot answer those yet, inspect more before drafting.

## 9. Use claim-based section titles

Turn findings into section titles that teach something.

Weak:

- `Architecture Overview`
- `Key Modules`
- `Data Flow`

Stronger:

- `The hard boundary is ownership, not rendering`
- `Most of the behavior hangs off one classification helper`
- `The server mostly binds context and gets out of the way`

A reader should learn something from the heading alone.
