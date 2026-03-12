# Codebase Analysis Workflow

Use this before drafting the artifact.

## 1. Find the entry points

Locate where execution or public use begins.
Common places:

| Ecosystem | Typical entry points |
| --- | --- |
| Node / Bun | `package.json`, CLI bins, server bootstrap files |
| Python | `__main__.py`, CLI modules, framework app factories |
| Go | `func main()` |
| Rust | `src/main.rs` or exported library surface |
| Web apps | router setup, page entry files, server bootstrap |
| Libraries | exported modules, main interfaces, public types |

For libraries, start from the public API, not an imaginary runtime entry point.

## 2. Trace the data flow

Starting from the entry point, follow:

1. what input comes in
2. what transformations happen
3. what output or side effects leave the system

Useful questions:

- What does this code consume?
- What invariants matter?
- Where are errors handled?
- Which types or objects move through multiple stages?

These usually define the spine of the document.

## 3. Find parallel or background work

Look for non-linear flows such as:

- event handlers
- background jobs
- polling or subscriptions
- worker queues
- timers
- signal handling
- retries and recovery logic

These often deserve their own section instead of being buried inside the happy path.

## 4. Choose the right diagram shape

If a diagram helps, decide what single idea it should explain.

| Goal | Diagram |
| --- | --- |
| module relationships | `graph TD` |
| request lifecycle | `sequenceDiagram` |
| data pipeline | `graph LR` |
| state transitions | `stateDiagram-v2` |

Prefer one clear diagram over one crowded diagram.
If the diagram is substantial, save it as a separate Mermaid artifact.

## 5. Decide the psychological order

Use the order that makes the system easiest to understand.

### Top-down
Start with architecture, then drill into parts.
Best for layered apps and services.

### Data-centric
Start with core types or schema, then operations.
Best for pipelines, stateful logic, and parsers.

### Request-lifecycle
Follow one request or event end-to-end.
Best for APIs, jobs, and UI actions.

### Change-centric
Start with the motivation for the diff, then explain changed surfaces and downstream effects.
Best for PRs and refactors.

## 6. Keep large scopes honest

If the requested scope is too large for a useful artifact:

- focus on the core loop
- focus on the touched subsystem
- group similar modules instead of exhaustively enumerating them
- state what you deliberately left out

A strong partial document beats a weak pretend-complete document.

## 7. Capture evidence while inspecting

Keep notes on:

- files inspected
- key functions or types
- exact paths for excerpts
- unresolved questions
- claims that need verification against code

When you write, cite those paths precisely.
