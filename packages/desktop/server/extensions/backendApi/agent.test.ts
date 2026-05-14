import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  abortAgentConversation,
  createAgentConversation,
  disposeAgentConversation,
  getAgentConversation,
  listAgentConversations,
  resetExtensionAgentDynamicImportForTests,
  runAgentTask,
  sendAgentMessage,
  setExtensionAgentDynamicImportForTests,
} from './agent.js';

function createSession(overrides?: { prompt?: () => Promise<void>; messages?: unknown[]; emitText?: boolean }) {
  const subscribers: Array<(event: any) => void> = [];
  const session = {
    messages: overrides?.messages ?? [],
    subscribe: vi.fn((handler: (event: any) => void) => {
      subscribers.push(handler);
      return () => undefined;
    }),
    prompt: vi.fn(async () => {
      if (overrides?.prompt) return overrides.prompt();
      if (overrides?.emitText === false) return;
      subscribers.forEach((handler) =>
        handler({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'probe result' }] } }),
      );
    }),
    abort: vi.fn(),
    dispose: vi.fn(),
  };
  return session;
}

function installImporter(options?: { session?: ReturnType<typeof createSession>; permissions?: string[] }) {
  const session = options?.session ?? createSession();
  const createAgentSession = vi.fn(async () => ({ session }));
  const importer = vi.fn(async (specifier: string) => {
    if (specifier === '@earendil-works/pi-coding-agent') {
      return {
        createAgentSession,
        AuthStorage: { create: vi.fn((path: string) => ({ path })) },
        SessionManager: { inMemory: vi.fn((cwd: string) => ({ cwd })) },
      };
    }
    if (specifier === '../extensionRegistry.js') {
      return {
        findExtensionEntry: vi.fn(() => ({ manifest: { permissions: options?.permissions ?? ['agent:run', 'agent:conversations'] } })),
      };
    }
    throw new Error(`unexpected import: ${specifier}`);
  });
  setExtensionAgentDynamicImportForTests(importer as never);
  return { createAgentSession, importer, session };
}

function createCtx(overrides?: Record<string, unknown>) {
  const model = { provider: 'openai', id: 'gpt-vision', input: ['text', 'image'] };
  return {
    extensionId: 'system-image-probe',
    toolContext: { cwd: '/workspace' },
    agentToolContext: {
      cwd: '/agent-cwd',
      model,
      modelRegistry: {
        getAvailable: () => [model, { provider: 'openai', id: 'text-only', input: ['text'] }],
      },
    },
    ...overrides,
  } as never;
}

describe('extension agent backend API', () => {
  afterEach(() => {
    resetExtensionAgentDynamicImportForTests();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('runs runAgentTask as create/send/dispose sugar', async () => {
    const { createAgentSession, session } = installImporter();

    const result = await runAgentTask(
      { prompt: 'Describe', modelRef: 'openai/gpt-vision', images: [{ type: 'image', data: 'abc', mimeType: 'image/png' }], tools: 'none' },
      createCtx(),
    );

    expect(result).toEqual({ text: 'probe result', model: 'gpt-vision', provider: 'openai' });
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/workspace', noTools: 'all' }));
    expect(session.prompt).toHaveBeenCalledWith('Describe', { images: [{ type: 'image', data: 'abc', mimeType: 'image/png' }] });
    expect(session.dispose).toHaveBeenCalled();
  });

  it('keeps extension-owned hidden conversations for multiple sends', async () => {
    installImporter();
    const ctx = createCtx();

    const created = await createAgentConversation({ title: 'Probe thread', tools: 'none' }, ctx);
    const first = await sendAgentMessage({ conversationId: created.id, text: 'first' }, ctx);
    const second = await sendAgentMessage({ conversationId: created.id, text: 'second' }, ctx);
    const listed = await listAgentConversations({}, ctx);
    const fetched = await getAgentConversation({ conversationId: created.id }, ctx);

    expect(first.text).toBe('probe result');
    expect(second.text).toBe('probe result');
    expect(listed.map((item) => item.id)).toContain(created.id);
    expect(fetched).toMatchObject({
      id: created.id,
      ownerExtensionId: 'system-image-probe',
      visibility: 'hidden',
      persistence: 'ephemeral',
    });
  });

  it('hides conversations from other extension owners', async () => {
    installImporter();
    const created = await createAgentConversation({ title: 'Private' }, createCtx());

    await expect(getAgentConversation({ conversationId: created.id }, createCtx({ extensionId: 'other-extension' }))).rejects.toThrow(
      'not found',
    );
  });

  it('delegates visible saved conversations to the host conversation capability', async () => {
    installImporter();
    const conversations = {
      create: vi.fn(async () => ({ id: 'visible-conversation' })),
      sendMessage: vi.fn(async () => ({ accepted: true })),
      getMeta: vi.fn(async () => ({
        id: 'visible-conversation',
        title: 'Visible title',
        cwd: '/visible-cwd',
        running: false,
        currentModel: 'gpt-vision',
      })),
      list: vi.fn(async () => []),
      abort: vi.fn(async () => ({ ok: true as const })),
    };
    const ctx = createCtx({ conversations });

    const created = await createAgentConversation(
      { title: 'Visible thread', cwd: '/visible-cwd', modelRef: 'openai/gpt-vision', visibility: 'visible', persistence: 'saved' },
      ctx,
    );
    const sent = await sendAgentMessage({ conversationId: created.id, text: 'keep going' }, ctx);
    const fetched = await getAgentConversation({ conversationId: created.id }, ctx);
    const aborted = await abortAgentConversation({ conversationId: created.id }, ctx);

    expect(created).toMatchObject({ id: 'visible-conversation', visibility: 'visible', persistence: 'saved' });
    expect(conversations.create).toHaveBeenCalledWith({ cwd: '/visible-cwd', model: 'openai/gpt-vision' });
    expect(conversations.sendMessage).toHaveBeenCalledWith('visible-conversation', 'keep going');
    expect(sent).toMatchObject({ id: 'visible-conversation', visibility: 'visible', persistence: 'saved' });
    expect(fetched).toMatchObject({ title: 'Visible title', cwd: '/visible-cwd', model: 'gpt-vision' });
    expect(conversations.abort).toHaveBeenCalledWith('visible-conversation');
    expect(aborted).toMatchObject({ id: 'visible-conversation', isBusy: false });
  });

  it('rejects mixed visibility and persistence modes', async () => {
    installImporter();

    await expect(createAgentConversation({ visibility: 'visible', persistence: 'ephemeral' }, createCtx())).rejects.toThrow(
      'hidden+ephemeral or visible+saved',
    );
    await expect(createAgentConversation({ visibility: 'hidden', persistence: 'saved' }, createCtx())).rejects.toThrow(
      'hidden+ephemeral or visible+saved',
    );
  });

  it('falls back to session messages when no message_end event emits text', async () => {
    installImporter({
      session: createSession({ emitText: false, messages: [{ role: 'assistant', content: [{ type: 'text', text: 'from messages' }] }] }),
    });

    await expect(runAgentTask({ prompt: 'Describe' }, createCtx())).resolves.toMatchObject({ text: 'from messages' });
  });

  it('rejects image input for text-only models', async () => {
    installImporter();

    await expect(
      runAgentTask(
        { prompt: 'Describe', modelRef: 'text-only', images: [{ type: 'image', data: 'abc', mimeType: 'image/png' }] },
        createCtx(),
      ),
    ).rejects.toThrow('does not accept images');
  });

  it('requires agent:conversations permission for retained sessions', async () => {
    installImporter({ permissions: ['agent:run'] });

    await expect(createAgentConversation({ title: 'Denied' }, createCtx())).rejects.toThrow('requires permission agent:conversations');
  });

  it('disposes retained sessions explicitly', async () => {
    const { session } = installImporter();
    const created = await createAgentConversation({ title: 'Dispose me' }, createCtx());

    await expect(disposeAgentConversation({ conversationId: created.id }, createCtx())).resolves.toEqual({
      ok: true,
      conversationId: created.id,
    });
    expect(session.dispose).toHaveBeenCalled();
    await expect(getAgentConversation({ conversationId: created.id }, createCtx())).rejects.toThrow('not found');
  });

  it('aborts and disposes the session when a task times out', async () => {
    vi.useFakeTimers();
    const session = createSession({ prompt: () => new Promise(() => undefined) });
    installImporter({ session });

    const assertion = expect(runAgentTask({ prompt: 'Describe', timeoutMs: 10 }, createCtx())).rejects.toThrow('timed out after 10ms');
    await vi.advanceTimersByTimeAsync(10);

    await assertion;
    expect(session.abort).toHaveBeenCalled();
    expect(session.dispose).toHaveBeenCalled();
  });
});
