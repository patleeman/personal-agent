import { describe, expect, it } from 'vitest';
import { DEFAULT_SIDEBAR_BRAND_LABEL, getSidebarBrandLabel } from './sidebarBrand';

describe('sidebar brand label', () => {
  it('returns the active profile name when present', () => {
    expect(getSidebarBrandLabel('datadog')).toBe('datadog');
  });

  it('trims surrounding whitespace from the active profile name', () => {
    expect(getSidebarBrandLabel(' assistant ')).toBe('assistant');
  });

  it('falls back to the default label when the profile is missing', () => {
    expect(getSidebarBrandLabel(undefined)).toBe(DEFAULT_SIDEBAR_BRAND_LABEL);
    expect(getSidebarBrandLabel(null)).toBe(DEFAULT_SIDEBAR_BRAND_LABEL);
    expect(getSidebarBrandLabel('   ')).toBe(DEFAULT_SIDEBAR_BRAND_LABEL);
  });
});
