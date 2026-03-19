import { describe, expect, it, vi } from 'vitest';
import { createGatewayCoordinatorTools } from './coordinator-tools.js';
import { setGatewayExtensionRuntimeContext } from './extensions/runtime-context.js';

function createDelegateTool(startDelegateRun = vi.fn(async () => ({ runId: 'run-123', logPath: '/tmp/run-123.log' }))) {
  const tools = createGatewayCoordinatorTools({
    profileName: 'assistant',
    startDelegateRun,
  });
  const delegateTool = tools.find((tool) => tool.name === 'delegate') as {
    execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }> }>;
  } | undefined;
  if (!delegateTool) {
    throw new Error('Delegate tool was not registered.');
  }

  return { delegateTool, startDelegateRun };
}

function createContext(sessionFile = '/tmp/sessions/telegram-1.jsonl') {
  const sessionManager = {
    getSessionFile: () => sessionFile,
  };
  setGatewayExtensionRuntimeContext(sessionManager, {
    provider: 'telegram',
    conversationId: '1::thread:99',
  });

  return {
    cwd: '/tmp/workspace',
    sessionManager,
  };
}

describe('gateway coordinator tools', () => {
  it('passes the persisted session file when starting a delegated resume run', async () => {
    const { delegateTool, startDelegateRun } = createDelegateTool();

    const result = await delegateTool.execute(
      'tool-1',
      {
        action: 'start',
        taskSlug: 'code-review',
        prompt: 'Review the latest diff',
        notifyMode: 'resume',
      },
      undefined,
      undefined,
      createContext() as never,
    );

    expect(result.isError).not.toBe(true);
    expect(startDelegateRun).toHaveBeenCalledWith({
      conversationId: '1::thread:99',
      sessionFile: '/tmp/sessions/telegram-1.jsonl',
      taskSlug: 'code-review',
      taskPrompt: 'Review the latest diff',
      workerPrompt: expect.stringContaining('Review the latest diff'),
      cwd: '/tmp/workspace',
      model: undefined,
      notifyMode: 'resume',
    });
  });

  it('rejects delegated resume mode when the session file is unavailable', async () => {
    const { delegateTool, startDelegateRun } = createDelegateTool();

    const result = await delegateTool.execute(
      'tool-1',
      {
        action: 'start',
        taskSlug: 'code-review',
        prompt: 'Review the latest diff',
        notifyMode: 'resume',
      },
      undefined,
      undefined,
      createContext('') as never,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Delegated resume requires a persisted session file.');
    expect(startDelegateRun).not.toHaveBeenCalled();
  });
});
