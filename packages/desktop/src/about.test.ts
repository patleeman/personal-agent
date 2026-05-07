import { describe, expect, it } from 'vitest';

import { buildDesktopAboutPanelOptions } from './about.js';

// ── about — about panel options builder ───────────────────────────────────

describe('buildDesktopAboutPanelOptions', () => {
  it('includes application name, version, and credits', () => {
    const options = buildDesktopAboutPanelOptions({
      applicationName: 'Personal Agent',
      applicationVersion: '0.7.6',
      piVersion: '1.2.3',
    });

    expect(options.applicationName).toBe('Personal Agent');
    expect(options.applicationVersion).toBe('0.7.6');
    expect(options.credits).toContain('1.2.3');
  });
});
