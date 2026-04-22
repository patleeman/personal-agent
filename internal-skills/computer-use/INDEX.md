---
id: computer-use
kind: internal-skill
title: Computer Use
summary: Built-in guidance for using the single computer_use tool to operate visible macOS app windows.
---

# Computer Use

Use this internal skill when the task requires operating a visible **macOS app window** rather than only reading files, editing code, or running shell commands.

The built-in runtime surface is a single tool:

- `computer_use`

## When to use it

Reach for `computer_use` when you need to:

- inspect the current state of a native macOS app window
- click, move, drag, or scroll inside a visible app window
- type into the currently focused control in that window
- press shortcuts in that app
- wait for loading or animations and then refresh the screenshot

Prefer normal file, shell, browser, and conversation tools when they are enough.

## Core loop

1. Start with `computer_use({ action: "observe" })`.
2. If you need a specific app or window, use `app` and optionally `windowTitle` in that observe call.
3. Use coordinates from the **latest screenshot** for `click`, `double_click`, `move`, `drag`, and `scroll`.
4. After every successful action, use the returned screenshot and `captureId` for the next step.
5. If state changes unexpectedly or a capture becomes stale, run `observe` again.

## Action reference

### `observe`

Capture the current target window, or select a new target with:

- `app`
- `windowTitle`

Use this first and any time you want to switch windows or refresh the state.

### `click`

Requires:

- `x`
- `y`

Optional:

- `button`
- `captureId`

### `double_click`

Requires:

- `x`
- `y`

Optional:

- `captureId`

### `move`

Move the cursor inside the current target window.

Requires:

- `x`
- `y`

Optional:

- `captureId`

### `drag`

Requires:

- `path` with at least two points

Optional:

- `captureId`

### `scroll`

Requires:

- `x`
- `y`
- `scrollX`
- `scrollY`

Optional:

- `captureId`

Treat the scroll values as signed input deltas, not guaranteed pixel-perfect viewport movement.

### `type`

Requires:

- `text`

Usually you should click the intended field first, then type.

### `keypress`

Requires:

- `keys`

Use normalized key tokens like:

- `['CMD', 'L']`
- `['SHIFT', 'TAB']`
- `['ENTER']`

### `wait`

Optional:

- `ms`

Use this when a visible app needs time to load or animate before you observe the next state.

## Practical rules

- Coordinates are always **window-relative screenshot pixels**.
- The current target window persists across successful `computer_use` actions inside the session.
- `captureId` is optional but useful when you want the runtime to reject stale coordinates.
- If a target window disappears, retarget with `observe`.
- Do only the minimum necessary UI interaction.

## Failure recovery

If a `computer_use` action fails:

- refresh with `computer_use({ action: "observe" })`
- verify you are still targeting the right app and window
- retry using coordinates from the newest screenshot

## Related docs

- [Native UI Automation](../../docs/native-ui-automation.md)
- [Skills and Runtime Capabilities](../skills-and-capabilities/INDEX.md)
