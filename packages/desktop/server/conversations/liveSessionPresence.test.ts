import { describe, expect, it } from 'vitest';

import {
  assertLiveSessionSurfaceCanControl,
  buildLiveSessionPresenceState,
  createLiveSessionPresenceHost,
  LiveSessionControlError,
  registerLiveSessionSurface,
  removeLiveSessionSurface,
  takeOverLiveSessionSurface,
} from './liveSessionPresence.js';

describe('liveSessionPresence', () => {
  it('registers surfaces and keeps the newest same-type surface in control', () => {
    const host = createLiveSessionPresenceHost();

    expect(registerLiveSessionSurface(host, { surfaceId: 'desktop-1', surfaceType: 'desktop_web' })).toBe(true);
    expect(registerLiveSessionSurface(host, { surfaceId: 'mobile-1', surfaceType: 'mobile_web' })).toBe(true);
    expect(registerLiveSessionSurface(host, { surfaceId: 'desktop-2', surfaceType: 'desktop_web' })).toBe(true);

    const state = buildLiveSessionPresenceState(host);
    expect(state.surfaces.map((surface) => surface.surfaceId).sort()).toEqual(['desktop-1', 'desktop-2', 'mobile-1']);
    expect(state.controllerSurfaceId).toBe('desktop-2');
    expect(state.controllerSurfaceType).toBe('desktop_web');
  });

  it('requires explicit takeover for a different surface type', () => {
    const host = createLiveSessionPresenceHost();
    registerLiveSessionSurface(host, { surfaceId: 'desktop-1', surfaceType: 'desktop_web' });
    registerLiveSessionSurface(host, { surfaceId: 'mobile-1', surfaceType: 'mobile_web' });

    expect(() => assertLiveSessionSurfaceCanControl(host, 'mobile-1')).toThrow(LiveSessionControlError);

    const takeover = takeOverLiveSessionSurface(host, 'mobile-1');
    expect(takeover.changed).toBe(true);
    expect(takeover.state.controllerSurfaceId).toBe('mobile-1');
    expect(() => assertLiveSessionSurfaceCanControl(host, 'mobile-1')).not.toThrow();
  });

  it('tracks duplicate connections and only removes a surface when the last connection closes', () => {
    const host = createLiveSessionPresenceHost();
    registerLiveSessionSurface(host, { surfaceId: 'desktop-1', surfaceType: 'desktop_web' });
    registerLiveSessionSurface(host, { surfaceId: 'desktop-1', surfaceType: 'desktop_web' });

    expect(removeLiveSessionSurface(host, 'desktop-1')).toBe(false);
    expect(buildLiveSessionPresenceState(host).controllerSurfaceId).toBe('desktop-1');

    expect(removeLiveSessionSurface(host, 'desktop-1')).toBe(true);
    expect(buildLiveSessionPresenceState(host)).toMatchObject({
      surfaces: [],
      controllerSurfaceId: null,
      controllerSurfaceType: null,
      controllerAcquiredAt: null,
    });
  });
});
