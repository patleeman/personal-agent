---
id: browser
kind: internal-skill
title: Built-in Workbench Browser
summary: Guidance for the desktop workbench Browser tab, browser comments, and how it differs from the agent-browser CLI.
tools: []
---

# Built-in Workbench Browser

The built-in Browser is the user-facing browser surface inside the Electron desktop app's Workbench layout.

Use this internal skill when work touches:

- the right-side Workbench **Browser** tab
- browser comments attached to composer prompts
- browser snapshot/action behavior inside Electron
- the boundary between the built-in browser and the `agent-browser` CLI/dev tool

## Product model

The Workbench Browser is an Electron-owned `WebContentsView` embedded in the desktop app.

It is for:

- letting Patrick browse a page beside a conversation
- letting Patrick right-click page elements and attach comments to the next prompt
- eventually giving agents a visible browser surface inside the app

It is not a general-purpose replacement for Chrome, and it should not expose agent/debug controls directly to normal users.

## User-facing behavior

The Browser tab should stay boring:

- Back and forward controls
- Reload/stop icon control
- URL field; pressing Enter navigates
- page viewport
- right-click menu item: **Comment on this**

Do not show agent-only controls such as JSON action batches, raw snapshots, or automation debug output in the user UI. If those capabilities exist, keep them behind agent/tool APIs or developer diagnostics.

## Browser comments

Right-clicking inside the browser and choosing **Comment on this** captures a target bundle and opens a small comment box over the page.

The target bundle should include enough metadata for both humans and agents:

- URL and page title
- best-effort selector
- XPath/DOM fallback
- role and accessible name
- test id when present
- element text and nearby text
- trimmed HTML preview
- viewport rect, scroll position, and device pixel ratio

When the comment is saved, it appears as a pending composer marker. On prompt send, pending browser comments are injected as `contextMessages` with `customType: "browser-comments"`, then cleared after successful send. If send fails, pending comments should be restored with the rest of the composer draft.

Browser comments are prompt context, not durable page annotations. Avoid building a full annotation database until there is a clear need.

## Agent-facing browser use

The desired direction is one browser session per conversation workbench:

- the Browser tab is the visual surface
- Electron main owns navigation, state, snapshots, actions, and comments
- agent browser tools should target that same session when running inside desktop conversations
- if an agent uses a built-in browser tool and the Browser tab is closed, the app should open Workbench → Browser automatically

Avoid creating two unrelated browsers for the same task. A Playwright/`agent-browser` session and the built-in Electron Browser tab drifting apart is bad UX.

## Relationship to `agent-browser`

`agent-browser` is still useful as a CLI/dev validation tool. In this repo, use it through `npm run ab:run` as documented in [Agent Browser](../../docs/agent-browser.md).

Do not confuse that with the built-in Workbench Browser:

- **Workbench Browser**: product UI surface in Electron; user-visible; supports comments and future built-in agent browser tools.
- **agent-browser CLI**: external automation/dev validation tool; Playwright/CDP-backed; used by agents while developing or validating UI.

Long term, desktop browser tools should use the Workbench Browser session directly instead of launching an unrelated `agent-browser` session.

## Implementation notes

Current relevant files:

- `packages/desktop/src/workbench-browser.ts` — Electron browser view controller, validation, actions, comments
- `packages/desktop/src/window.ts` — owns the browser controller and routes window-scoped operations
- `packages/desktop/src/ipc.ts` and `packages/desktop/src/preload.ts` — bridge browser operations/events
- `packages/web/src/components/Layout.tsx` — Workbench Browser UI and comment overlay
- `packages/web/src/pages/ConversationPage.tsx` — pending browser comments in the composer and prompt context injection

Keep changes scoped. The Browser tab is part of Workbench layout, not a new standalone app shell.

## UX rules

- Keep the page viewport large; do not put the actual browser inside the narrow rail.
- Keep user chrome minimal.
- Do not add boxes-inside-boxes around the browser controls.
- Use text/icons with light hover treatment for navigation controls.
- Keep the URL field editable; browser state sync must not fight user typing.
- Default to a neutral normal start page unless Patrick specifies otherwise.
