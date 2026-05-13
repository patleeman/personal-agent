// @vitest-environment jsdom
import React, { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppEventsContext, INITIAL_APP_EVENT_VERSIONS } from '../app/contexts';
import { INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS } from '../conversation/conversationEventVersions';
import type { AppEventTopic } from '../shared/types';
import type { RefetchOptions } from './useApi';
import { useInvalidateOnTopics } from './useInvalidateOnTopics';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];
let latestBumpSessionsVersion: (() => void) | null = null;

function InvalidateProbe({ topics, refetch }: { topics: AppEventTopic[]; refetch: (options?: RefetchOptions) => Promise<unknown> }) {
  useInvalidateOnTopics(topics, refetch);
  return null;
}

function Harness({
  topics = ['sessions'],
  refetch,
}: {
  topics?: AppEventTopic[];
  refetch: (options?: RefetchOptions) => Promise<unknown>;
}) {
  const [versions, setVersions] = useState(INITIAL_APP_EVENT_VERSIONS);

  latestBumpSessionsVersion = () => {
    setVersions((current) => ({
      ...current,
      sessions: current.sessions + 1,
    }));
  };

  return (
    <AppEventsContext.Provider
      value={{
        versions,
        conversationVersions: INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS,
      }}
    >
      <InvalidateProbe topics={topics} refetch={refetch} />
    </AppEventsContext.Provider>
  );
}

function flushPromises() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('useInvalidateOnTopics', () => {
  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => root.unmount());
    }

    latestBumpSessionsVersion = null;
    vi.restoreAllMocks();
  });

  it('does not refetch on initial mount in StrictMode', async () => {
    const refetch = vi.fn().mockResolvedValue(null);
    const root = createRoot(document.createElement('div'));
    mountedRoots.push(root);

    await act(async () => {
      root.render(
        <StrictMode>
          <Harness refetch={refetch} />
        </StrictMode>,
      );
      await flushPromises();
      await flushPromises();
    });

    expect(refetch).not.toHaveBeenCalled();
  });

  it('refetches after an observed topic version changes', async () => {
    const refetch = vi.fn().mockResolvedValue(null);
    const root = createRoot(document.createElement('div'));
    mountedRoots.push(root);

    await act(async () => {
      root.render(<Harness refetch={refetch} />);
      await flushPromises();
    });

    expect(refetch).not.toHaveBeenCalled();

    await act(async () => {
      latestBumpSessionsVersion?.();
      await flushPromises();
    });

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith({ resetLoading: false });
  });

  it('swallows rejected background refetches', async () => {
    const refetch = vi.fn().mockRejectedValue(new Error('Conversation not found'));
    const onUnhandledRejection = vi.fn((event: PromiseRejectionEvent) => event.preventDefault());
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    const root = createRoot(document.createElement('div'));
    mountedRoots.push(root);

    try {
      await act(async () => {
        root.render(
          <StrictMode>
            <Harness refetch={refetch} />
          </StrictMode>,
        );
        await flushPromises();
      });

      await act(async () => {
        latestBumpSessionsVersion?.();
        await flushPromises();
        await flushPromises();
      });

      expect(refetch).toHaveBeenCalledTimes(1);
      expect(onUnhandledRejection).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    }
  });
});
