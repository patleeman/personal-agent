import { describe, expect, it } from 'vitest';

import { shouldDispatchReadonlyLocalApiInWorker } from './readonly-local-api.js';

describe('shouldDispatchReadonlyLocalApiInWorker', () => {
  const workerAvailable = { readonlyLocalApiWorkerAvailable: true };

  it('offloads broad readonly desktop api routes on the local host', () => {
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/status', hostId: 'local', ...workerAvailable })).toBe(true);
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/sessions', hostId: 'local', ...workerAvailable })).toBe(
      true,
    );
    expect(
      shouldDispatchReadonlyLocalApiInWorker({ method: 'POST', path: '/api/sessions/search-index', hostId: 'local', ...workerAvailable }),
    ).toBe(true);
    expect(
      shouldDispatchReadonlyLocalApiInWorker({ method: 'POST', path: '/api/sessions/search', hostId: 'local', ...workerAvailable }),
    ).toBe(true);
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/settings', hostId: 'local', ...workerAvailable })).toBe(
      true,
    );
    expect(
      shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/settings/schema', hostId: 'local', ...workerAvailable }),
    ).toBe(true);
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'PATCH', path: '/api/settings', hostId: 'local', ...workerAvailable })).toBe(
      false,
    );
    expect(
      shouldDispatchReadonlyLocalApiInWorker({
        method: 'GET',
        path: '/api/live-sessions/session-1/context',
        hostId: 'local',
        ...workerAvailable,
      }),
    ).toBe(true);
    expect(
      shouldDispatchReadonlyLocalApiInWorker({
        method: 'GET',
        path: '/api/conversations/session-1/bootstrap',
        hostId: 'local',
        ...workerAvailable,
      }),
    ).toBe(true);
    expect(
      shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/workspace/tree?cwd=/repo', hostId: 'local', ...workerAvailable }),
    ).toBe(true);
    expect(
      shouldDispatchReadonlyLocalApiInWorker({
        method: 'GET',
        path: '/api/workspace/file?cwd=/repo&path=a.ts',
        hostId: 'local',
        ...workerAvailable,
      }),
    ).toBe(true);
    expect(
      shouldDispatchReadonlyLocalApiInWorker({
        method: 'GET',
        path: '/api/workspace/diff?cwd=/repo&path=a.ts',
        hostId: 'local',
        ...workerAvailable,
      }),
    ).toBe(true);
  });

  it('keeps readonly routes on the main thread when the worker module is missing', () => {
    expect(
      shouldDispatchReadonlyLocalApiInWorker({
        method: 'GET',
        path: '/api/workspace/tree?cwd=/repo',
        hostId: 'local',
        readonlyLocalApiWorkerAvailable: false,
      }),
    ).toBe(false);
  });

  it('keeps live-registry-only reads on the main thread', () => {
    expect(
      shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/live-sessions/session-1', hostId: 'local', ...workerAvailable }),
    ).toBe(false);
    expect(
      shouldDispatchReadonlyLocalApiInWorker({
        method: 'GET',
        path: '/api/live-sessions/session-1/fork-entries',
        hostId: 'local',
        ...workerAvailable,
      }),
    ).toBe(false);
  });

  it('never offloads remote host reads', () => {
    expect(shouldDispatchReadonlyLocalApiInWorker({ method: 'GET', path: '/api/tasks', hostId: 'ssh-box', ...workerAvailable })).toBe(
      false,
    );
  });
});
