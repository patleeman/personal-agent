import { describe, expect, it, vi } from 'vitest';

import { APP_LAYOUT_MODE_CHANGED_EVENT, createAppLayoutModeChangedEvent, writeAppLayoutMode } from './appLayoutMode';

describe('app layout mode state', () => {
  it('emits a same-window change event when writing the layout mode', () => {
    const eventTarget = new EventTarget();
    const listener = vi.fn();
    const previousWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = eventTarget;
    eventTarget.addEventListener(APP_LAYOUT_MODE_CHANGED_EVENT, listener);

    try {
      writeAppLayoutMode('workbench');
    } finally {
      eventTarget.removeEventListener(APP_LAYOUT_MODE_CHANGED_EVENT, listener);
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = previousWindow;
      }
    }

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]?.[0] as CustomEvent<{ mode: string }>).detail.mode).toBe('workbench');
  });

  it('creates typed layout mode change events', () => {
    const event = createAppLayoutModeChangedEvent('compact');

    expect(event.type).toBe(APP_LAYOUT_MODE_CHANGED_EVENT);
    expect(event.detail.mode).toBe('compact');
  });
});
