import { describe, expect, it } from 'vitest';

import { type ExtensionSurfaceSummary, isExtensionRightToolPanelSurface } from './types';

describe('extension surface type guards', () => {
  it('recognizes right rail tool panels with iframe entries', () => {
    const surface: ExtensionSurfaceSummary = {
      extensionId: 'agent-board',
      id: 'rail',
      placement: 'right',
      kind: 'toolPanel',
      label: 'Board',
      entry: 'frontend/rail.html',
      scope: 'conversation',
    };

    expect(isExtensionRightToolPanelSurface(surface)).toBe(true);
  });

  it('rejects incomplete right rail surfaces', () => {
    expect(
      isExtensionRightToolPanelSurface({
        extensionId: 'agent-board',
        id: 'rail',
        placement: 'right',
        kind: 'toolPanel',
        label: 'Board',
        scope: 'conversation',
      } as ExtensionSurfaceSummary),
    ).toBe(false);
  });
});
