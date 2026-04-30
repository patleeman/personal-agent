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

There is one browser session per conversation workbench and three agent-facing browser tools:

- `browser_snapshot` — observe the current browser state
- `browser_cdp` — send one or more Chrome DevTools Protocol commands to the current browser session
- `browser_screenshot` — capture the current browser viewport as an image

These tools should target the built-in Workbench Browser session, not an unrelated Playwright/`agent-browser` session.

The product model:

- the Browser tab is the visual surface
- browser sessions are scoped to the active conversation, like the workbench file/explorer state
- switching conversations preserves each conversation's embedded webview instead of reusing one global browser
- Electron main owns navigation, state, snapshots, actions, and comments
- agent browser tools target that same session when running inside desktop conversations
- if an agent uses a built-in browser tool and the Browser tab is closed, the app opens Workbench → Browser automatically

Avoid creating two unrelated browsers for the same task. A Playwright/`agent-browser` session and the built-in Electron Browser tab drifting apart is bad UX.

### `browser_snapshot`

Use `browser_snapshot` as the browser equivalent of `read`: it gives the agent eyes.

It should return:

- URL and title
- loading state
- browser revision metadata, including whether the page changed since the last snapshot
- visible text summary
- accessibility-oriented element rows when possible: role, name, state, bounds
- DOM fallback metadata: selector, XPath, text snippet, HTML preview
- stable per-snapshot refs such as `@e1`, `@e2`, etc.

Example shape:

```text
URL: https://example.com/login
Title: Sign in

@e1 role=textbox name="Email" selector="input[name=email]" enabled=true
@e2 role=textbox name="Password" selector="input[name=password]" enabled=true
@e3 role=button name="Sign in" selector="button[type=submit]" enabled=true
```

Refs are snapshot-scoped. After navigation or major DOM changes, take a fresh snapshot before using refs again.

Prefer accessibility data for role/name/state, but always include DOM fallback selectors so the page can be inspected and discussed clearly.

If the user manually changes the page after the last agent snapshot — for example logging in, clicking, typing, or navigating — the next user prompt includes `browser-changed-since-snapshot` context. Treat that as a stale-observation warning and call `browser_snapshot` before assuming the old page state is still true.

### `browser_cdp`

Use `browser_cdp` when direct browser control is needed. It sends raw Chrome DevTools Protocol command objects to the current Workbench Browser session. Send a single object for one command:

```json
{
  "command": { "method": "Runtime.evaluate", "params": { "expression": "document.title", "returnByValue": true } }
}
```

Send an array of command objects for multi-step actions instead of firing many separate tool calls:

```json
{
  "command": [
    { "method": "Input.dispatchMouseEvent", "params": { "type": "mouseMoved", "x": 300, "y": 250 } },
    { "method": "Input.dispatchMouseEvent", "params": { "type": "mousePressed", "x": 300, "y": 250, "button": "left", "clickCount": 1 } },
    { "method": "Input.dispatchMouseEvent", "params": { "type": "mouseMoved", "x": 520, "y": 420, "button": "left", "buttons": 1 } },
    { "method": "Input.dispatchMouseEvent", "params": { "type": "mouseReleased", "x": 520, "y": 420, "button": "left", "clickCount": 1 } }
  ]
}
```

The tool is intentionally thin. Agents should provide CDP method names and params exactly as Chrome expects. Commands execute sequentially and stop on the first protocol error unless `continueOnError` is true. Useful commands include:

- `Runtime.evaluate` for page JavaScript and structured page inspection
- `Page.navigate` for navigation
- `DOM.getDocument`, `DOM.querySelector`, and related DOM commands for node-level inspection
- `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent` for low-level input

Prefer `browser_snapshot` for normal observation and `browser_screenshot` for visual checks. Use CDP when the task needs direct control or a specific protocol capability.

### `browser_screenshot`

Use `browser_screenshot` when visual layout matters or when DOM/accessibility snapshots are not enough.

Default to `browser_snapshot`. Snapshot is preferred for normal browsing because it is structured, cheaper, includes refs/selectors, and is better for text, feeds, lists, forms, buttons, and current page state. Do not use screenshots just to read a page.

Good screenshot cases:

- Patrick explicitly asks for a screenshot or visual check
- CSS/layout/visual rendering matters
- canvas/image-heavy content is important
- `browser_snapshot` is missing information needed to answer correctly

It should return an image attachment or image data plus basic metadata:

- URL and title
- viewport size
- timestamp
- image MIME/data/path according to the tool system's normal attachment conventions

Current desktop tool output returns PNG data as base64 in tool details with URL/title/viewport metadata.

### Auto-open behavior

When any built-in browser tool runs from a desktop conversation:

1. switch to Workbench mode if needed
2. select the Browser tab
3. ensure the browser pane exists
4. return the tool result to the transcript

Do not show raw script/debug panels in the user Browser tab. The transcript is where tool details belong.

## Relationship to `agent-browser`

`agent-browser` is still useful as a CLI/dev validation tool. In this repo, use it through `npm run ab:run` as documented in [Agent Browser](../../docs/agent-browser.md).

Do not confuse that with the built-in Workbench Browser:

- **Workbench Browser**: product UI surface in Electron; user-visible; supports comments and future built-in agent browser tools.
- **agent-browser CLI**: external automation/dev validation tool; Playwright/CDP-backed; used by agents while developing or validating UI.

Long term, desktop browser tools should use the Workbench Browser session directly instead of launching an unrelated `agent-browser` session.

## Implementation notes

Current relevant files:

- `packages/desktop/src/workbench-browser.ts` — Electron browser view controller, validation, snapshots, screenshots, comments
- `packages/desktop/src/window.ts` — owns the browser controller and routes window-scoped operations
- `packages/desktop/src/ipc.ts` and `packages/desktop/src/preload.ts` — bridge browser operations/events
- `packages/web/server/extensions/workbenchBrowserAgentExtension.ts` — Pi tool registration for `browser_snapshot`, `browser_cdp`, and `browser_screenshot`
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
