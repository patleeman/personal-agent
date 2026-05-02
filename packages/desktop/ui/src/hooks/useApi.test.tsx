// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { useApi, type UseApiResult } from './useApi';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];
let latestResult: UseApiResult<string> | null = null;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function HookProbe({ cacheKey, fetcher }: { cacheKey: string; fetcher: () => Promise<string> }) {
  latestResult = useApi(fetcher, cacheKey);
  return null;
}

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount());
  }
  latestResult = null;
});

describe('useApi', () => {
  it('clears stale data immediately when the cache key changes', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const root = createRoot(document.createElement('div'));
    mountedRoots.push(root);

    await act(async () => {
      root.render(<HookProbe cacheKey="first" fetcher={() => first.promise} />);
    });

    await act(async () => {
      first.resolve('first-result');
      await first.promise;
    });
    expect(latestResult?.data).toBe('first-result');
    expect(latestResult?.loading).toBe(false);

    await act(async () => {
      root.render(<HookProbe cacheKey="second" fetcher={() => second.promise} />);
    });

    expect(latestResult?.data).toBeNull();
    expect(latestResult?.loading).toBe(true);

    await act(async () => {
      second.resolve('second-result');
      await second.promise;
    });
    expect(latestResult?.data).toBe('second-result');
    expect(latestResult?.loading).toBe(false);
  });

  it('does not let an older in-flight fetch overwrite replaced data', async () => {
    const first = createDeferred<string>();
    const refresh = createDeferred<string>();
    let callCount = 0;
    const root = createRoot(document.createElement('div'));
    mountedRoots.push(root);

    await act(async () => {
      root.render(
        <HookProbe
          cacheKey="same"
          fetcher={() => {
            callCount += 1;
            return callCount === 1 ? first.promise : refresh.promise;
          }}
        />,
      );
    });

    await act(async () => {
      first.resolve('initial');
      await first.promise;
    });
    expect(latestResult?.data).toBe('initial');

    await act(async () => {
      void latestResult?.refetch({ resetLoading: false });
    });
    await act(async () => {
      latestResult?.replaceData('optimistic');
    });

    await act(async () => {
      refresh.resolve('older-refresh');
      await refresh.promise;
    });

    expect(latestResult?.data).toBe('optimistic');
    expect(latestResult?.refreshing).toBe(false);
  });
});
