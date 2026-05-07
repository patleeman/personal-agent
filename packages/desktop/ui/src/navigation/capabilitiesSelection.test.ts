import { describe, expect, it } from 'vitest';

import {
  buildCapabilitiesSearch,
  getCapabilitiesPresetId,
  getCapabilitiesSection,
  getCapabilitiesTaskId,
  getCapabilitiesToolName,
} from './capabilitiesSelection';

// ── capabilitiesSelection — URL param helpers for capabilities rail ───────

describe('getCapabilitiesSection', () => {
  it('defaults to overview when absent', () => {
    expect(getCapabilitiesSection('')).toBe('overview');
    expect(getCapabilitiesSection('?other=x')).toBe('overview');
  });

  it('returns the selected section', () => {
    expect(getCapabilitiesSection('?section=presets')).toBe('presets');
    expect(getCapabilitiesSection('?section=scheduled')).toBe('scheduled');
    expect(getCapabilitiesSection('?section=tools')).toBe('tools');
  });

  it('falls back to overview for unknown sections', () => {
    expect(getCapabilitiesSection('?section=nope')).toBe('overview');
  });
});

describe('getCapabilitiesPresetId', () => {
  it('returns null when absent', () => {
    expect(getCapabilitiesPresetId('')).toBeNull();
  });

  it('returns the preset id', () => {
    expect(getCapabilitiesPresetId('?preset=my-preset')).toBe('my-preset');
  });
});

describe('getCapabilitiesTaskId', () => {
  it('returns null when absent', () => {
    expect(getCapabilitiesTaskId('')).toBeNull();
  });

  it('returns the task id', () => {
    expect(getCapabilitiesTaskId('?task=t-123')).toBe('t-123');
  });
});

describe('getCapabilitiesToolName', () => {
  it('returns null when absent', () => {
    expect(getCapabilitiesToolName('')).toBeNull();
  });

  it('returns the tool name', () => {
    expect(getCapabilitiesToolName('?tool=bash')).toBe('bash');
  });
});

describe('buildCapabilitiesSearch', () => {
  it('builds a basic search string with section', () => {
    const result = buildCapabilitiesSearch('', { section: 'presets' });
    expect(result).toContain('section=presets');
  });

  it('clears params when switching to a section that does not use them', () => {
    const result = buildCapabilitiesSearch('?preset=abc&task=xyz', { section: 'tools' });
    expect(result).toContain('section=tools');
    expect(result).not.toContain('preset=');
    expect(result).not.toContain('task=');
  });

  it('sets preset when section is presets', () => {
    const result = buildCapabilitiesSearch('', { section: 'presets', presetId: 'my-preset' });
    expect(result).toContain('section=presets');
    expect(result).toContain('preset=my-preset');
  });

  it('sets task when section is scheduled', () => {
    const result = buildCapabilitiesSearch('', { section: 'scheduled', taskId: 't-999' });
    expect(result).toContain('section=scheduled');
    expect(result).toContain('task=t-999');
  });

  it('sets tool when section is tools', () => {
    const result = buildCapabilitiesSearch('', { section: 'tools', toolName: 'bash' });
    expect(result).toContain('section=tools');
    expect(result).toContain('tool=bash');
  });
});
