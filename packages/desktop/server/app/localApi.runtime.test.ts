import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startKnowledgeBaseSyncLoopMock = vi.fn();
const subscribeKnowledgeBaseStateMock = vi.fn(() => vi.fn());

vi.mock('./bootstrap.js', async () => {
  const actual = await vi.importActual<typeof import('./bootstrap.js')>('./bootstrap.js');
  return {
    ...actual,
    startDeferredResumeLoop: vi.fn(),
  };
});

vi.mock('@personal-agent/core', async () => {
  const actual = await vi.importActual<typeof import('@personal-agent/core')>('@personal-agent/core');
  return {
    ...actual,
    startKnowledgeBaseSyncLoop: startKnowledgeBaseSyncLoopMock,
    subscribeKnowledgeBaseState: subscribeKnowledgeBaseStateMock,
  };
});

describe('localApi knowledge base sync loop startup', () => {
  beforeEach(() => {
    startKnowledgeBaseSyncLoopMock.mockClear();
    subscribeKnowledgeBaseStateMock.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSONAL_AGENT_DESKTOP_RUNTIME;
    startKnowledgeBaseSyncLoopMock.mockClear();
    subscribeKnowledgeBaseStateMock.mockClear();
    vi.resetModules();
  });

  it('starts the knowledge base sync loop in managed web runtime', async () => {
    delete process.env.PERSONAL_AGENT_DESKTOP_RUNTIME;

    await import('./localApi.js');

    expect(subscribeKnowledgeBaseStateMock).toHaveBeenCalledTimes(1);
    expect(startKnowledgeBaseSyncLoopMock).toHaveBeenCalledTimes(1);
  }, 15000);

  it('skips the knowledge base sync loop in desktop runtime', async () => {
    process.env.PERSONAL_AGENT_DESKTOP_RUNTIME = '1';

    await import('./localApi.js');

    expect(subscribeKnowledgeBaseStateMock).toHaveBeenCalledTimes(1);
    expect(startKnowledgeBaseSyncLoopMock).not.toHaveBeenCalled();
  }, 15000);
});
