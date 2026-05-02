import { describe, expect, it } from 'vitest';

import { clampPanelWidth, getRailInitialWidth, getRailLayoutPrefs, getRailMaxWidth } from './layoutSizing.js';

describe('layout sizing helpers', () => {
  it('clamps panel width to the provided bounds', () => {
    expect(clampPanelWidth(100, 220, 700)).toBe(220);
    expect(clampPanelWidth(480, 220, 700)).toBe(480);
    expect(clampPanelWidth(900, 220, 700)).toBe(700);
    expect(clampPanelWidth(Number.NaN, 220, 700)).toBe(220);
    expect(clampPanelWidth(Number.MAX_SAFE_INTEGER + 1, 220, Number.MAX_SAFE_INTEGER + 2)).toBe(220);
    expect(clampPanelWidth(480.5, 220, 700)).toBe(220);
  });

  it('returns per-route rail preferences', () => {
    expect(getRailLayoutPrefs('/conversations/session-123')).toEqual({
      storageKey: 'pa:rail-width:conversations',
      initialWidth: 380,
    });

    expect(getRailLayoutPrefs('/automations/daily-review')).toEqual({
      storageKey: 'pa:rail-width:automations',
      initialWidth: 380,
    });

    expect(getRailLayoutPrefs('/settings')).toEqual({
      storageKey: 'pa:rail-width:settings',
      initialWidth: 380,
    });
  });

  it('falls back to the default rail width for unknown routes', () => {
    expect(
      getRailInitialWidth({
        pathname: '/unknown',
        viewportWidth: 1600,
        sidebarWidth: 224,
        railMinWidth: 160,
        railMaxWidth: 1046,
      }),
    ).toBe(380);
  });

  it('lets the rail expand until the main pane reaches its minimum width', () => {
    expect(
      getRailMaxWidth({
        viewportWidth: 1600,
        sidebarWidth: 224,
        railMinWidth: 160,
        mainMinWidth: 320,
      }),
    ).toBe(1046);
  });

  it('never returns less than the rail minimum width', () => {
    expect(
      getRailMaxWidth({
        viewportWidth: 700,
        sidebarWidth: 320,
        railMinWidth: 220,
      }),
    ).toBe(220);
  });

  it('falls back to the rail minimum for malformed viewport geometry', () => {
    expect(
      getRailMaxWidth({
        viewportWidth: 1600.5,
        sidebarWidth: 224,
        railMinWidth: 220,
        mainMinWidth: 320,
      }),
    ).toBe(220);
  });
});
