import { describe, expect, it } from 'vitest';

import { listExtensionComposerShelfRegistrations, listExtensionNewConversationPanelRegistrations } from './extensionRegistry.js';

describe('extension composer shelves', () => {
  it('surfaces suggested context as a new conversation panel, not a composer shelf', () => {
    expect(listExtensionNewConversationPanelRegistrations()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          extensionId: 'system-suggested-context',
          id: 'suggested-context',
          component: 'SuggestedContextPanel',
          priority: 100,
        }),
      ]),
    );
    expect(listExtensionComposerShelfRegistrations()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ extensionId: 'system-suggested-context' })]),
    );
  });

  it('does not surface global scheduled task counts in conversation composers', () => {
    expect(listExtensionComposerShelfRegistrations()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ extensionId: 'system-automations' })]),
    );
  });
});
