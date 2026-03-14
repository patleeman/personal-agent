---
id: personal-agent
title: "personal-agent Project Notes"
summary: "Current project direction, UX constraints, and core model notes for the personal-agent repo."
type: "project"
status: "active"
tags:
  - "personal-agent"
  - "tui"
  - "gateway"
updated: 2026-03-14
---

# personal-agent Project Notes

## Architecture mental model

- `personal-agent` is a durable application layer around Pi, not a separate model runtime: Pi runs the agent loop, while this repo decides what stays portable, what stays machine-local, and how the same agent appears through CLI, web UI, daemon, and Telegram.
- `packages/resources` is the profile-materialization boundary: it merges shared, profile, and local overlays into one runtime agent shape that the other surfaces reuse.
- `packages/web` carries most live-conversation product semantics: it hosts in-process Pi sessions, resolves references, records pending operations, and projects state to the client over SSE.
- `packages/daemon` owns unattended execution and recovery; `packages/gateway` owns more than chat transport, including service-management and web UI deployment logic.
- HTML artifacts render as standalone blobs in the artifact panel, so CSS, fonts, and similar assets that must affect rendering need to be inlined or otherwise embedded instead of referenced as sibling repo files.

## Current interface direction

- Keep `pa tui` as one Pi TUI instance per terminal tab; do not assume a pane-managed workbench UI.
- Use daemon-backed durable runs for background orchestration, not a terminal multiplexer.
- Keep richer workbench-style UX experimentation in the web UI, not in a more complex Pi TUI shell.

## State model direction

- Long-term, Patrick wants one personal-agent home outside the repo that cleanly separates synced durable app/profile state from machine-local runtime state.
- Cross-machine sync for that durable home should be versioned and conflict-tolerant without relying on Git-style merge workflows for high-churn app state.

## Web conversation UX constraints

- Keep conversation-header metadata compact and low-noise: prefer plain text over pill badges, keep model/thinking/context on one row when practical, and prefer one clear `Resume` path over duplicate recovery controls.
- The command palette should be the unified search surface for open conversations, archived conversations, memories, tasks, and projects; changing focus should change scope within one menu, not open parallel modal families.
- Command-palette search should support keyboard scope cycling and content-aware fuzzy search, including memory body text and archived user/assistant message text.
- Context-usage UI and any breakdowns must be compaction-aware: derive from the effective current context, never from lifetime totals or the full transcript.
- Treat the chat scrollbar as a quiet right-edge conversation rail that preserves transcript width and makes user turns more prominent landmarks than assistant turns.
- In the session right rail, runs are secondary inspectability data: keep them below referenced projects and collapsed by default with a compact summary.
- Use human-readable project labels/descriptions as the primary UI text; opaque generated project ids are secondary metadata.
- In the right rail/project UI, prefer a single focused project card with inline remove controls over nested pill-plus-box chrome.
- Web conversations should stay cwd-agnostic by default: explicit `cwd` wins; otherwise inherit from a single referenced project's durable `repoRoot` instead of assuming the server working directory.
- UI and CLI toggles should perform their named effect when feasible; avoid controls that only persist intent while leaving the real side effect as a separate manual operator step.

## Memory + attachment direction

- Treat checkpoints as a memory-distillation action, not as a separate durable object; distilled results should land as normal memory docs.
- Starting a conversation from a memory and `@`-mentioning memories are the preferred interaction patterns; if a standalone memory page becomes redundant, move AGENTS/skills browsing into Tools instead of keeping a separate configuration surface.
- Conversation attachments should be first-class local runtime objects, separate from project artifacts.
- Excalidraw support should preserve editable `.excalidraw` source plus rendered previews so the agent can inspect the drawing and Patrick can revise it later.

## Conversation + inbox model

- Keep the roles distinct: the conversation is the live work thread, while the inbox is the resurfacing layer for asynchronous or dormant work.
- Do not duplicate the same result into both places when Patrick is already looking at the active conversation; use the inbox for background-task output and other completions that need to be surfaced later.

## Gateway scope

- Discord support was intentionally removed because Patrick does not use it.
- Telegram gateway and daemon tasks remain first-class surfaces.
- Background daemon work should default to the currently active profile instead of opportunistically running every profile's tasks.

## Core model direction

- Treat `personal-agent` as one personal agent for Patrick, not a general multi-user product.
- Profiles are domain/context boundaries layered on top of a shared agent identity; in practice, each machine usually has one dominant active profile.
- New conversations should start from durable profile memory (`AGENTS.md`, skills, memory docs), not from blank transcript state.
- Tasks should be first-class, profile-scoped objects that can start in one surface, run elsewhere, and later be resumed or checked from another surface.

## Conversation durability and locality

- Conversation state and metadata are machine-local runtime state under `~/.local/state/personal-agent/**`, not repo-managed profile artifacts.
- Portable repo artifacts must not reference conversation ids; when something needs to sync across machines, use stable task/project identifiers plus summaries or other durable metadata instead.
- Cross-surface conversation handoff (Telegram ↔ web UI) should bind both surfaces to the same underlying conversation/session rather than duplicating durable threads.
- Agent runs should survive UI restarts so the web UI can reconnect to durable local workers instead of owning the run lifecycle.
- Archived/open conversation views should enumerate all locally available personal-agent conversations rather than filtering to the current cwd, and fork flows should stay in-app.

## Inspectability and context reduction

- Keep the full conversation or execution trail inspectable when Patrick needs to drill in.
- Also maintain compact summaries that expose durable facts, progress, blockers, decisions, artifacts, and next actions without reloading the full transcript.
- Treat inspectability as a core trust requirement, not only a debugging aid.

## Revisit gate

- Do not reintroduce multi-pane/tab workbench UX for the TUI without a fresh user decision.
