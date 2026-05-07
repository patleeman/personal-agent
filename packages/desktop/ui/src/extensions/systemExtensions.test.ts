import { describe, expect, it } from 'vitest';

import { findSystemExtensionPage, SYSTEM_EXTENSION_PAGE_SURFACES } from './systemExtensions';

describe('system extension page registry', () => {
  it('registers automations as a system extension page', () => {
    expect(SYSTEM_EXTENSION_PAGE_SURFACES).toEqual([
      { extensionId: 'system-automations', surfaceId: 'page', route: '/automations', component: 'automations' },
    ]);
    expect(findSystemExtensionPage('/automations')).toEqual(SYSTEM_EXTENSION_PAGE_SURFACES[0]);
    expect(findSystemExtensionPage('/automations/daily-report')).toEqual(SYSTEM_EXTENSION_PAGE_SURFACES[0]);
    expect(findSystemExtensionPage('/settings')).toBeNull();
  });
});
