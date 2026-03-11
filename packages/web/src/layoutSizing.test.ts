import { describe, expect, it } from 'vitest';
import { clampPanelWidth, getRailMaxWidth } from './layoutSizing.js';

describe('layout sizing helpers', () => {
  it('clamps panel width to the provided bounds', () => {
    expect(clampPanelWidth(100, 220, 700)).toBe(220);
    expect(clampPanelWidth(480, 220, 700)).toBe(480);
    expect(clampPanelWidth(900, 220, 700)).toBe(700);
    expect(clampPanelWidth(Number.NaN, 220, 700)).toBe(220);
  });

  it('caps the rail at half of the main viewport width', () => {
    expect(getRailMaxWidth({
      viewportWidth: 1600,
      sidebarWidth: 224,
      railMinWidth: 220,
    })).toBe(683);
  });

  it('never returns less than the rail minimum width', () => {
    expect(getRailMaxWidth({
      viewportWidth: 700,
      sidebarWidth: 320,
      railMinWidth: 220,
    })).toBe(220);
  });
});
