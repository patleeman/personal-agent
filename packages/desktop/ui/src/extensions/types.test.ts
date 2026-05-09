import { describe, expect, it } from 'vitest';

import {
  getExtensionViewActivation,
  getExtensionViewPlacement,
  getExtensionViewScope,
  isNativeExtensionPageSurface,
  isNativeExtensionRightRailSurface,
  isNativeExtensionWorkbenchSurface,
  type NativeExtensionViewSummary,
} from './types';

describe('extension surface type guards', () => {
  it('recognizes native main page surfaces', () => {
    const surface: NativeExtensionViewSummary = {
      extensionId: 'agent-board',
      id: 'page',
      title: 'Agent Board',
      location: 'main',
      route: '/ext/agent-board',
      component: 'AgentBoardPage',
      frontend: { entry: 'dist/frontend.js' },
    };

    expect(isNativeExtensionPageSurface(surface)).toBe(true);
  });

  it('recognizes native right rail surfaces', () => {
    const surface: NativeExtensionViewSummary = {
      extensionId: 'agent-board',
      id: 'rail',
      title: 'Board',
      location: 'rightRail',
      scope: 'conversation',
      component: 'AgentBoardRail',
      frontend: { entry: 'dist/frontend.js' },
    };

    expect(isNativeExtensionRightRailSurface(surface)).toBe(true);
  });

  it('recognizes native workbench surfaces', () => {
    const surface: NativeExtensionViewSummary = {
      extensionId: 'agent-board',
      id: 'detail',
      title: 'Board detail',
      location: 'workbench',
      component: 'AgentBoardDetail',
      frontend: { entry: 'dist/frontend.js' },
    };

    expect(isNativeExtensionWorkbenchSurface(surface)).toBe(true);
  });

  it('rejects incomplete native surfaces', () => {
    expect(isNativeExtensionPageSurface({ extensionId: 'agent-board', id: 'page', location: 'main', component: 'AgentBoardPage' })).toBe(
      false,
    );
    expect(
      isNativeExtensionRightRailSurface({ extensionId: 'agent-board', id: 'rail', location: 'rightRail', component: 'AgentBoardRail' }),
    ).toBe(false);
  });

  it('normalizes placement, scope, and activation defaults', () => {
    expect(getExtensionViewPlacement({ location: 'main' })).toBe('primary');
    expect(getExtensionViewPlacement({ location: 'rightRail' })).toBe('conversation-rail');
    expect(getExtensionViewPlacement({ location: 'main', placement: 'adaptive-primary' })).toBe('adaptive-primary');
    expect(getExtensionViewScope({ location: 'rightRail', placement: 'conversation-rail' })).toBe('conversation');
    expect(getExtensionViewScope({ location: 'rightRail', placement: 'adaptive-primary', scope: 'global' })).toBe('global');
    expect(getExtensionViewActivation({ location: 'main', placement: 'primary' })).toBe('on-route');
    expect(getExtensionViewActivation({ location: 'rightRail', placement: 'conversation-rail' })).toBe('on-open');
  });
});
