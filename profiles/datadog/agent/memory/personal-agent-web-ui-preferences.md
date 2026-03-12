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
updated: 2026-03-12
---

# Personal-agent web UI preferences

Durable UX preferences repeatedly expressed for the personal-agent web interface.

## Shell and layout

- Keep the app feeling **inbox-first** and **conversation-first** rather than like a dense admin console.
- Prefer a single clear primary work area plus a contextual right rail over nested split panels or duplicated detail views.
- The right rail should be genuinely resizable, with route-aware sizing so different surfaces can remember different useful widths.
- If the right rail is important to the workflow, keep it visible and resizable rather than hiding it behind extra collapse/re-open chrome.
- The sidebar should feel more like **open tabs plus recent history** than one undifferentiated list.

## Conversation and project surfaces

- Keep active or open conversations visually distinct from recent conversation history.
- Use the right rail for high-value project detail and editing instead of pushing low-value summary chrome into the main pane.
- Favor fast, direct controls for common actions instead of burying state changes behind extra navigation.
- Preserve primary conversation drafts across reloads.
- Make archived-conversation restore and conversation forking first-class in-app flows rather than tiny popovers or new browser tabs.
- Open conversation tabs should be directly reorderable in the UI instead of fixed to creation order.
- Prefer human-readable labels in the UI. Fresh chats should render as `New Conversation`, raw ids should stay secondary, and open conversation titles/status should keep updating live without click-to-refresh.
- Prefer conversation titles that summarize the session from the first assistant response rather than copying the raw first user prompt when that makes the list easier to scan.
- Keep running state and needs-attention state separate. A running conversation does not automatically need attention; attention should surface when there is unseen output or the agent has stopped and now needs review.
- When a turn contains many tool calls or thinking blocks, collapse that internal activity into a single turn-level disclosure so the triggering user message and the assistant's visible answer stay in view together.
- Prefer conversation-centric turn rendering over a raw event-log feel; internal activity should stay inspectable on demand without dominating the main transcript.
- Prefer explicit labels over multiple ambiguous status dots when distinguishing states such as `running` and `needs review`.

## Keyboard workflow

- Support a keyboard-first loop: shortcut for new chat, shortcuts to move between open conversations, and fast composer clear/history actions.
- In the composer, `Ctrl+C` should preserve the current draft in local history before clearing it.

## Operational durability

- Treat the web UI as the default day-to-day programming interface rather than a fragile demo surface.
- Prefer durable update/restart flows, stable long-running server behavior, and inspectable logs over dev-only startup patterns.
- As the product shifts away from TUI-first usage, core interactive capabilities such as deferred resume should become first-class web UI flows instead of remaining TUI-only.

## Settings and defaults

- Put editable runtime defaults and appearance controls on a dedicated settings surface rather than scattering them across incidental UI chrome.
- Inspect available tools on a dedicated Tools surface rather than burying tool reference or schema inspection inside general settings.
- Do not surface TUI-only settings in the web UI when they do not affect the web experience.

## Memory surface

- Present memory in human terms rather than storage implementation details.
- The preferred framing is:
  - **Identity** — who the agent is
  - **Capabilities** — what the agent can do
  - **Knowledge** — what the agent has learned
- Avoid list-of-lists layouts that make users decode files, buckets, or internal grouping logic before they can understand what the agent knows.

## Visual style

- Avoid nested bordered boxes and decorative overuse of pills/chips.
- Prefer flatter hierarchy created by spacing, typography, and alignment.
