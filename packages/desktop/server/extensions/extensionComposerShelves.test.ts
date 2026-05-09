import { describe, expect, it } from 'vitest';

import { listExtensionComposerShelfRegistrations } from './extensionRegistry.js';

describe('extension composer shelves', () => {
  it('does not surface global scheduled task counts in conversation composers', () => {
    expect(listExtensionComposerShelfRegistrations()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ extensionId: 'system-automations' })]),
    );
  });
});
