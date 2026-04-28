import { describe, expect, it } from 'vitest';
import { shouldDispatchReadonlyLocalApiInWorker } from './readonly-local-api.js';

describe('shouldDispatchReadonlyLocalApiInWorker', () => {
  it('offloads broad readonly desktop api routes on the local host', () => {
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/status', hostId: 'local' })).toBe(true);
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/sessions', hostId: 'local' })).toBe(true);
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'POST', path: '/api/sessions/search-index', hostId: 'local' })).toBe(true);
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'POST', path: '/api/sessions/search', hostId: 'local' })).toBe(true);
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/live-sessions/session-1/context', hostId: 'local' })).toBe(true);
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/conversations/session-1/bootstrap', hostId: 'local' })).toBe(true);
  });

  it('keeps live-registry-only reads on the main thread', () => {
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/live-sessions/session-1', hostId: 'local' })).toBe(false);
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/live-sessions/session-1/fork-entries', hostId: 'local' })).toBe(false);
  });

  it('never offloads remote host reads', () => {
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/tasks', hostId: 'ssh-box' })).toBe(false);
  });
});
