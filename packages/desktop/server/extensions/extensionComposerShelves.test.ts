import { describe, expect, it } from 'vitest';

import { listExtensionComposerShelfRegistrations } from './extensionRegistry.js';

describe('extension composer shelves', () => {
  it('surfaces suggested context as a system composer shelf', () => {
    expect(listExtensionComposerShelfRegistrations()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          extensionId: 'system-suggested-context',
          id: 'suggested-context',
          component: 'SuggestedContextShelf',
          placement: 'top',
        }),
      ]),
    );
  });

  it('does not surface global scheduled task counts in conversation composers', () => {
    expect(listExtensionComposerShelfRegistrations()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ extensionId: 'system-automations' })]),
    );
  });
});
