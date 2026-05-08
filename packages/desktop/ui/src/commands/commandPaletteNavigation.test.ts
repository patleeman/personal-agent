import { describe, expect, it } from 'vitest';

import { buildCommandPaletteFileOpenRoute, supportsWorkbenchFilePane } from './commandPaletteNavigation';

describe('command palette navigation', () => {
  it('opens files in the current workbench pane on workbench routes', () => {
    expect(
      buildCommandPaletteFileOpenRoute({
        pathname: '/conversations/session-123',
        search: '?view=compact',
        hash: '#tail',
        layoutMode: 'workbench',
        fileId: 'notes/today.md',
      }),
    ).toBe('/conversations/session-123?view=compact&file=notes%2Ftoday.md#tail');
  });

  it('replaces an existing workbench file query param', () => {
    expect(
      buildCommandPaletteFileOpenRoute({
        pathname: '/automations',
        search: '?file=old.md&task=daily',
        layoutMode: 'workbench',
        fileId: 'notes/new.md',
        extensionSurfaces: [
          {
            extensionId: 'test-automation',
            packageType: 'user',
            id: 'page',
            title: 'Automation',
            location: 'main',
            route: '/automations',
            component: 'AutomationPage',
            routeCapabilities: ['workbenchFilePane'],
          },
        ],
      }),
    ).toBe('/automations?file=notes%2Fnew.md&task=daily');
  });

  it('falls back to the knowledge page outside workbench mode or workbench routes', () => {
    expect(
      buildCommandPaletteFileOpenRoute({
        pathname: '/conversations/session-123',
        search: '',
        layoutMode: 'compact',
        fileId: 'notes/today.md',
      }),
    ).toBe('/knowledge?file=notes%2Ftoday.md');

    expect(
      buildCommandPaletteFileOpenRoute({
        pathname: '/settings',
        search: '',
        layoutMode: 'workbench',
        fileId: 'notes/today.md',
      }),
    ).toBe('/knowledge?file=notes%2Ftoday.md');
  });

  it('only treats routes with a workbench document pane as workbench file routes', () => {
    expect(supportsWorkbenchFilePane('/conversations/new')).toBe(true);
    expect(supportsWorkbenchFilePane('/conversations-old')).toBe(false);
    expect(
      supportsWorkbenchFilePane('/automations', [
        {
          extensionId: 'test-automation',
          packageType: 'user',
          id: 'page',
          title: 'Automation',
          location: 'main',
          route: '/automations',
          component: 'AutomationPage',
          routeCapabilities: ['workbenchFilePane'],
        },
      ]),
    ).toBe(true);
    expect(supportsWorkbenchFilePane('/automations-history')).toBe(false);
    expect(supportsWorkbenchFilePane('/knowledge')).toBe(false);
  });
});
