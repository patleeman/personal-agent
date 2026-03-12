import { describe, expect, it } from 'vitest';
import { clampPanelWidth, getArtifactRailTargetWidth, getRailLayoutPrefs, getRailMaxWidth } from './layoutSizing.js';

describe('layout sizing helpers', () => {
  it('clamps panel width to the provided bounds', () => {
    expect(clampPanelWidth(100, 220, 700)).toBe(220);
    expect(clampPanelWidth(480, 220, 700)).toBe(480);
    expect(clampPanelWidth(900, 220, 700)).toBe(700);
    expect(clampPanelWidth(Number.NaN, 220, 700)).toBe(220);
  });

  it('returns per-route rail preferences', () => {
    expect(getRailLayoutPrefs('/projects/web-ui')).toEqual({
      storageKey: 'pa:rail-width:projects',
      initialWidth: 560,
    });

    expect(getRailLayoutPrefs('/conversations/session-123')).toEqual({
      storageKey: 'pa:rail-width:conversations',
      initialWidth: 380,
    });

    expect(getRailLayoutPrefs('/tasks/daily-review')).toEqual({
      storageKey: 'pa:rail-width:scheduled',
      initialWidth: 380,
    });
  });

  it('computes the 50% artifact rail target from the main viewport width', () => {
    expect(getArtifactRailTargetWidth({
      viewportWidth: 1600,
      sidebarWidth: 224,
    })).toBe(683);
  });

  it('lets the rail expand until the main pane reaches its minimum width', () => {
    expect(getRailMaxWidth({
      viewportWidth: 1600,
      sidebarWidth: 224,
      railMinWidth: 160,
      mainMinWidth: 320,
    })).toBe(1046);
  });

  it('never returns less than the rail minimum width', () => {
    expect(getRailMaxWidth({
      viewportWidth: 700,
      sidebarWidth: 320,
      railMinWidth: 220,
    })).toBe(220);
  });
});
