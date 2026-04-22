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

The current implementation is **accessibility-first**:

- `observe` returns a screenshot plus a flat list of accessibility elements with `elementId`s
- `click`, `type`, `set_value`, and `secondary_action` can target those `elementId`s directly
- raw coordinates still work, but they are the fallback path, not the default

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
3. Prefer `elementId` targets from that observe result for `click`, `type`, `set_value`, and `secondary_action`.
4. Use coordinates from the **latest screenshot** only when the relevant control is not exposed clearly through accessibility.
5. After a UI-changing action, run `observe` again when you need fresh element IDs for the new state.
6. If state changes unexpectedly or a capture becomes stale, run `observe` again.

## Action reference

### `observe`

Capture the current target window, or select a new target with:

- `app`
- `windowTitle`

Use this first and any time you want to switch windows or refresh the state.

### `click`

Use one of:

- `elementId`
- `x` + `y`

Optional:

- `button`
- `captureId`

Prefer `elementId` when observe returned the intended control.

### `double_click`

Use one of:

- `elementId`
- `x` + `y`

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

Optional:

- `elementId`
- `captureId`

If you provide `elementId`, the runtime will try a fast direct-value set first and fall back to click-plus-typing only when needed.

### `set_value`

Requires:

- `elementId`
- `text`

Optional:

- `captureId`

Use this for settable text fields and text areas when you want the fastest, least-janky path.

### `secondary_action`

Requires:

- `elementId`

Optional:

- `accessibilityAction`
- `captureId`

Use this for non-primary accessibility actions exposed by an element, such as menu-style or alternate actions.

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

- Prefer **element IDs first, coordinates second**.
- Coordinates are always **window-relative screenshot pixels**.
- The current target window persists across successful `computer_use` actions inside the session.
- `captureId` is optional but useful when you want the runtime to reject stale coordinates or stale element references.
- Element IDs come from the latest `observe` result. If you changed the UI and need fresh IDs, run `observe` again.
- If a target window disappears, retarget with `observe`.
- Do only the minimum necessary UI interaction.

## Failure recovery

If a `computer_use` action fails:

- refresh with `computer_use({ action: "observe" })`
- verify you are still targeting the right app and window
- prefer a fresh `elementId` from the new observe result
- fall back to coordinates from the newest screenshot only when accessibility targeting is not good enough

## Related docs

- [Native UI Automation](../../docs/native-ui-automation.md)
- [Skills and Runtime Capabilities](../skills-and-capabilities/INDEX.md)
