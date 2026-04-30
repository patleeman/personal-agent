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

The desired direction is one browser session per conversation workbench and three agent-facing browser tools:

- `browser_snapshot` — observe the current browser state
- `browser_script` — run a browser automation script against the current browser session
- `browser_screenshot` — capture visual state when layout or appearance matters

These tools should target the built-in Workbench Browser session, not an unrelated Playwright/`agent-browser` session.

The product model:

- the Browser tab is the visual surface
- Electron main owns navigation, state, snapshots, actions, and comments
- agent browser tools target that same session when running inside desktop conversations
- if an agent uses a built-in browser tool and the Browser tab is closed, the app should open Workbench → Browser automatically

Avoid creating two unrelated browsers for the same task. A Playwright/`agent-browser` session and the built-in Electron Browser tab drifting apart is bad UX.

### `browser_snapshot`

Use `browser_snapshot` as the browser equivalent of `read`: it gives the agent eyes.

It should return:

- URL and title
- loading state
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

Prefer accessibility data for role/name/state, but always include DOM fallback selectors so scripts can act.

### `browser_script`

Use `browser_script` as the browser equivalent of `bash`: one powerful script execution surface, not many tiny click/type tools.

Scripts should run against the current Workbench Browser session and can use refs from the latest snapshot.

Example:

```js
await browser.goto('https://www.google.com/');
await browser.type('textarea[name=q]', 'personal agent');
await browser.press('Enter');
await browser.waitForText('Personal Agent');
return await browser.snapshot();
```

Supported API should include at least:

Navigation and state:

- `await browser.goto(url)`
- `await browser.reload()`
- `await browser.back()`
- `await browser.forward()`
- `await browser.url()`
- `await browser.title()`

Observation:

- `await browser.snapshot()`
- `await browser.text(selectorOrRef?)`
- `await browser.html(selectorOrRef?)`
- `await browser.exists(selectorOrRef)`
- `await browser.query(selectorOrRef)`

Actions:

- `await browser.click(selectorOrRef)`
- `await browser.type(selectorOrRef, text)`
- `await browser.press(key)`
- `await browser.scroll(x, y)`
- `await browser.select(selectorOrRef, value)`
- `await browser.check(selectorOrRef)`
- `await browser.uncheck(selectorOrRef)`
- `await browser.setInputFiles(selectorOrRef, paths)`

Waiting:

- `await browser.wait(ms)`
- `await browser.waitFor(selectorOrRef)`
- `await browser.waitForText(text)`
- `await browser.waitForLoadState(state?)`

Escape hatch:

- `await browser.evaluate(fnOrSource, ...args)`

`evaluate` is allowed because it is too useful to omit. It runs in the loaded page context, not in Electron main or the Personal Agent renderer. It can inspect and mutate the loaded page, so tool output must show the script and failures clearly.

Diagnostics:

- `browser.log(...values)` should append to the tool result logs.
- returned values must be JSON-serializable and size-limited.

### `browser_screenshot`

Use `browser_screenshot` when visual layout matters or when DOM/accessibility snapshots are not enough.

It should return an image attachment or image data plus basic metadata:

- URL and title
- viewport size
- timestamp
- image MIME/data/path according to the tool system's normal attachment conventions

### Script isolation

Never execute agent-provided browser scripts directly in Electron main.

Correct model:

```text
agent script
  ↓
isolated worker / utility process / constrained VM
  ↓ RPC calls such as browser.click('@e1')
Electron main validates and applies operations to WebContentsView
  ↓
Workbench Browser page
```

Rules:

- Electron main is the broker, not the script sandbox.
- The worker gets only `browser`, `console`/`browser.log`, timers, and cancellation/timeout primitives.
- Do not expose Node builtins, filesystem, environment variables, Electron objects, app state, or IPC directly to the script.
- Hard-timeout scripts and terminate the worker/process on timeout.
- Size-limit logs and return values.
- Validate every operation in main before applying it to `WebContentsView`.
- `browser.evaluate(...)` executes only in the loaded page via `webContents.executeJavaScript`.
- Consider blocking or requiring explicit opt-in for `evaluate` on `personal-agent://app` pages so the agent cannot casually poke the host UI.

### Auto-open behavior

When any built-in browser tool runs from a desktop conversation:

1. switch to Workbench mode if needed
2. select the Browser tab
3. ensure the browser pane exists
4. show a small “Agent controlling browser” status while the tool is active
5. return the tool result to the transcript

Do not show raw script/debug panels in the user Browser tab. The transcript is where tool details belong.

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
