---
id: personal-agent-web-ui-preferences
title: "Personal-agent web UI preferences"
summary: "Durable UX preferences for the personal-agent web interface, especially layout clarity and memory presentation."
type: "project"
status: "active"
tags:
  - "personal-agent"
  - "web-ui"
  - "ux"
  - "product"
updated: 2026-03-11
---

# Personal-agent web UI preferences

Durable UX preferences repeatedly expressed for the personal-agent web interface.

## Shell and layout

- Keep the app feeling **inbox-first** and **conversation-first** rather than like a dense admin console.
- Prefer a single clear primary work area plus a contextual right rail over nested split panels or duplicated detail views.
- The right rail should be genuinely resizable, with route-aware sizing so different surfaces can remember different useful widths.
- The sidebar should feel more like **open tabs plus recent history** than one undifferentiated list.

## Conversation and project surfaces

- Keep active or open conversations visually distinct from recent conversation history.
- Use the right rail for high-value project detail and editing instead of pushing low-value summary chrome into the main pane.
- Favor fast, direct controls for common actions instead of burying state changes behind extra navigation.

## Memory surface

- Present memory in human terms rather than storage implementation details.
- The preferred framing is:
  - **Identity** — who the agent is
  - **Capabilities** — what the agent can do
  - **Knowledge** — what the agent has learned
- Avoid list-of-lists layouts that make users decode files, buckets, or internal grouping logic before they can understand what the agent knows.

## Visual style

- Apply the AGENTS-level UI bans consistently: no nested bordered boxes and no decorative overuse of pills/chips.
- Prefer flatter hierarchy created by spacing, typography, and alignment.
