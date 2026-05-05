// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../client/api';
import type { GatewayState } from '../shared/types';
import { GatewaysPage } from './GatewaysPage';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];

function createGatewayState(overrides?: Partial<GatewayState>): GatewayState {
  return {
    providers: [],
    connections: [],
    bindings: [],
    chatTargets: [],
    events: [],
    ...overrides,
  };
}

function renderPage() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/gateways']}>
        <Routes>
          <Route path="/gateways" element={<GatewaysPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });

  mountedRoots.push(root);
  return { container };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function typeInput(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!descriptor?.set) throw new Error('Expected HTMLInputElement value setter');

  act(() => {
    descriptor.set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function keyDown(element: HTMLElement, key: string) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('GatewaysPage', () => {
  let gatewaysMock: ReturnType<typeof vi.spyOn>;
  let updateGatewayConnectionMock: ReturnType<typeof vi.spyOn>;
  let detachGatewayConversationMock: ReturnType<typeof vi.spyOn>;
  let attachGatewayConversationMock: ReturnType<typeof vi.spyOn>;
  let searchSlackMcpChannelsMock: ReturnType<typeof vi.spyOn>;
  let attachSlackMcpChannelMock: ReturnType<typeof vi.spyOn>;
  let telegramGatewayTokenMock: ReturnType<typeof vi.spyOn>;
  let saveTelegramGatewayTokenMock: ReturnType<typeof vi.spyOn>;
  let deleteTelegramGatewayTokenMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    gatewaysMock = vi.spyOn(api, 'gateways');
    updateGatewayConnectionMock = vi.spyOn(api, 'updateGatewayConnection');
    detachGatewayConversationMock = vi.spyOn(api, 'detachGatewayConversation');
    attachGatewayConversationMock = vi.spyOn(api, 'attachGatewayConversation');
    searchSlackMcpChannelsMock = vi.spyOn(api, 'searchSlackMcpChannels');
    attachSlackMcpChannelMock = vi.spyOn(api, 'attachSlackMcpChannel');
    vi.spyOn(api, 'sessions').mockResolvedValue([
      {
        id: 'thread-1',
        file: '/tmp/thread-1.jsonl',
        timestamp: '2026-05-04T12:00:00Z',
        cwd: '/repo',
        cwdSlug: 'repo',
        model: 'openai/gpt-4o',
        title: 'Support thread',
        messageCount: 1,
      },
    ]);
    telegramGatewayTokenMock = vi.spyOn(api, 'telegramGatewayToken').mockResolvedValue({ configured: false });
    saveTelegramGatewayTokenMock = vi.spyOn(api, 'saveTelegramGatewayToken');
    deleteTelegramGatewayTokenMock = vi.spyOn(api, 'deleteTelegramGatewayToken');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
  });

  it('shows loading state while fetching', async () => {
    gatewaysMock.mockReturnValue(new Promise(() => {})); // never resolves
    telegramGatewayTokenMock.mockReturnValue(new Promise(() => {})); // never resolves
    vi.mocked(api.sessions).mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderPage();
    expect(container.textContent).toContain('Loading…');
  });

  it('shows empty state when no gateways are connected', async () => {
    gatewaysMock.mockResolvedValue(createGatewayState());
    const { container } = renderPage();
    await flushAsyncWork();
    expect(container.textContent).toContain('No gateways connected');
    expect(container.textContent).not.toContain('Connect Telegram');
    expect(container.textContent).toContain('No bot token stored');
    expect(container.textContent).toContain('Chat ID');
  });

  it('saves Telegram bot setup from the gateways page', async () => {
    gatewaysMock.mockResolvedValue(createGatewayState());
    saveTelegramGatewayTokenMock.mockResolvedValue({ configured: true, state: createGatewayState() });

    const { container } = renderPage();
    await flushAsyncWork();

    const input = container.querySelector<HTMLInputElement>('input[placeholder="123456:ABC-DEF…"]');
    expect(input).toBeTruthy();
    typeInput(input!, 'token-123');

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Add bot');
    expect(saveButton).toBeTruthy();
    click(saveButton!);
    await flushAsyncWork();

    expect(saveTelegramGatewayTokenMock).toHaveBeenCalledWith('token-123');
    expect(container.textContent).toContain('Bot token stored');
  });

  it('removes Telegram bot setup from the gateways page', async () => {
    gatewaysMock.mockResolvedValue(createGatewayState());
    telegramGatewayTokenMock.mockResolvedValue({ configured: true });
    deleteTelegramGatewayTokenMock.mockResolvedValue({ configured: false, state: createGatewayState() });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { container } = renderPage();
    await flushAsyncWork();

    const removeButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Remove bot');
    expect(removeButton).toBeTruthy();
    click(removeButton!);
    await flushAsyncWork();

    expect(deleteTelegramGatewayTokenMock).toHaveBeenCalled();
    expect(container.textContent).toContain('No bot token stored');
  });

  it('lets users replace an existing Telegram bot token', async () => {
    gatewaysMock.mockResolvedValue(createGatewayState());
    telegramGatewayTokenMock.mockResolvedValue({ configured: true });
    saveTelegramGatewayTokenMock.mockResolvedValue({ configured: true, state: createGatewayState() });

    const { container } = renderPage();
    await flushAsyncWork();

    expect(container.querySelector<HTMLInputElement>('input[placeholder="123456:ABC-DEF…"]')).toBeFalsy();
    const replaceButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Replace token');
    expect(replaceButton).toBeTruthy();
    click(replaceButton!);
    await flushAsyncWork();

    const input = container.querySelector<HTMLInputElement>('input[placeholder="123456:ABC-DEF…"]');
    expect(input).toBeTruthy();
    typeInput(input!, 'new-token');
    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save token');
    expect(saveButton).toBeTruthy();
    click(saveButton!);
    await flushAsyncWork();

    expect(saveTelegramGatewayTokenMock).toHaveBeenCalledWith('new-token');
    expect(container.textContent).toContain('Replace token');
  });

  it('attaches a Telegram chat to a selected thread', async () => {
    gatewaysMock.mockResolvedValue(createGatewayState());
    telegramGatewayTokenMock.mockResolvedValue({ configured: true });
    const attachedState = createGatewayState({
      connections: [
        {
          id: 'tg-1',
          provider: 'telegram',
          label: 'Telegram',
          status: 'active',
          enabled: true,
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T12:00:00Z',
        },
      ],
      bindings: [
        {
          id: 'b-tg-1',
          provider: 'telegram',
          connectionId: 'tg-1',
          conversationId: 'thread-1',
          conversationTitle: 'Support thread',
          externalChatId: '123456789',
          externalChatLabel: '123456789',
          repliesEnabled: true,
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T12:00:00Z',
        },
      ],
    });
    attachGatewayConversationMock.mockResolvedValue(attachedState);

    const { container } = renderPage();
    await flushAsyncWork();

    const chatInput = container.querySelector<HTMLInputElement>('input[placeholder="123456789"]');
    expect(chatInput).toBeTruthy();
    typeInput(chatInput!, '123456789');
    const attachButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Attach chat');
    expect(attachButton).toBeTruthy();
    click(attachButton!);
    await flushAsyncWork();

    expect(attachGatewayConversationMock).toHaveBeenCalledWith({
      provider: 'telegram',
      conversationId: 'thread-1',
      conversationTitle: 'Support thread',
      externalChatId: '123456789',
      externalChatLabel: '123456789',
    });
    expect(container.textContent).toContain('Support thread');
  });

  it('displays error from API', async () => {
    gatewaysMock.mockRejectedValue(new Error('Gateway API unavailable'));
    const { container } = renderPage();
    await flushAsyncWork();
    expect(container.textContent).toContain('Gateway API unavailable');
  });

  it('renders a connected Telegram gateway', async () => {
    gatewaysMock.mockResolvedValue(
      createGatewayState({
        connections: [
          {
            id: 'tg-1',
            provider: 'telegram',
            label: 'My Telegram',
            status: 'active',
            enabled: true,
            createdAt: '2026-05-04T00:00:00Z',
            updatedAt: '2026-05-04T12:00:00Z',
          },
        ],
        bindings: [
          {
            id: 'b-tg-1',
            provider: 'telegram',
            connectionId: 'tg-1',
            conversationId: 'conv-abc',
            conversationTitle: 'Telegram Chat',
            externalChatId: 'chat-123',
            externalChatLabel: 'My Chat',
            repliesEnabled: true,
            createdAt: '2026-05-04T00:00:00Z',
            updatedAt: '2026-05-04T12:00:00Z',
          },
        ],
      }),
    );
    const { container } = renderPage();
    await flushAsyncWork();

    expect(container.textContent).toContain('Telegram');
    expect(container.textContent).toContain('Active');
    expect(container.textContent).toContain('Open thread');
    expect(container.textContent).toContain('Detach');
    expect(container.textContent).toContain('Pause');
  });

  it('renders a connected Slack MCP gateway', async () => {
    gatewaysMock.mockResolvedValue(
      createGatewayState({
        connections: [
          {
            id: 'sl-1',
            provider: 'slack_mcp',
            label: 'Slack Workspace',
            status: 'active',
            enabled: true,
            createdAt: '2026-05-04T00:00:00Z',
            updatedAt: '2026-05-04T12:00:00Z',
          },
        ],
        bindings: [
          {
            id: 'b-sl-1',
            provider: 'slack_mcp',
            connectionId: 'sl-1',
            conversationId: 'conv-def',
            conversationTitle: 'Slack Thread',
            externalChatId: 'C12345',
            externalChatLabel: '#general',
            repliesEnabled: true,
            createdAt: '2026-05-04T00:00:00Z',
            updatedAt: '2026-05-04T12:00:00Z',
          },
        ],
      }),
    );
    const { container } = renderPage();
    await flushAsyncWork();

    expect(container.textContent).toContain('Slack MCP');
    expect(container.textContent).toContain('Active');
    expect(container.textContent).toContain('Open thread');
    expect(container.textContent).toContain('Detach');
    // Slack row should not have Pause/Resume
    expect(container.textContent).not.toContain('Pause');
  });

  it('shows Slack search when Slack MCP exists without a channel binding', async () => {
    gatewaysMock.mockResolvedValue(
      createGatewayState({
        connections: [
          {
            id: 'sl-1',
            provider: 'slack_mcp',
            label: 'Slack Workspace',
            status: 'active',
            enabled: true,
            createdAt: '2026-05-04T00:00:00Z',
            updatedAt: '2026-05-04T12:00:00Z',
          },
        ],
        bindings: [],
      }),
    );
    const { container } = renderPage();
    await flushAsyncWork();

    expect(container.querySelector<HTMLInputElement>('input[placeholder="Search channels…"]')).toBeTruthy();
    expect(container.textContent).not.toContain('Slack channel—');
  });

  it('formats activity kinds for display', async () => {
    gatewaysMock.mockResolvedValue(
      createGatewayState({
        events: [
          {
            id: 'evt-1',
            provider: 'slack_mcp',
            kind: 'routing',
            message: 'Slack MCP channel attached',
            createdAt: '2026-05-04T12:00:00Z',
          },
        ],
      }),
    );
    const { container } = renderPage();
    await flushAsyncWork();

    expect(container.textContent).toContain('Routing');
  });

  it('renders Telegram in paused state', async () => {
    gatewaysMock.mockResolvedValue(
      createGatewayState({
        connections: [
          {
            id: 'tg-1',
            provider: 'telegram',
            label: 'My Telegram',
            status: 'paused',
            enabled: false,
            createdAt: '2026-05-04T00:00:00Z',
            updatedAt: '2026-05-04T12:00:00Z',
          },
        ],
        bindings: [
          {
            id: 'b-tg-1',
            provider: 'telegram',
            connectionId: 'tg-1',
            conversationId: 'conv-abc',
            conversationTitle: 'Telegram Chat',
            externalChatId: 'chat-123',
            externalChatLabel: 'My Chat',
            repliesEnabled: true,
            createdAt: '2026-05-04T00:00:00Z',
            updatedAt: '2026-05-04T12:00:00Z',
          },
        ],
      }),
    );
    const { container } = renderPage();
    await flushAsyncWork();

    expect(container.textContent).toContain('Paused');
    expect(container.textContent).toContain('Resume');
  });

  it('pauses Telegram via updateGatewayConnection', async () => {
    const activeState = createGatewayState({
      connections: [
        {
          id: 'tg-1',
          provider: 'telegram',
          label: 'My Telegram',
          status: 'active',
          enabled: true,
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T12:00:00Z',
        },
      ],
      bindings: [
        {
          id: 'b-tg-1',
          provider: 'telegram',
          connectionId: 'tg-1',
          conversationId: 'conv-abc',
          conversationTitle: 'Telegram Chat',
          externalChatId: 'chat-123',
          externalChatLabel: 'My Chat',
          repliesEnabled: true,
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T12:00:00Z',
        },
      ],
    });
    gatewaysMock.mockResolvedValue(activeState);

    const pausedState = createGatewayState({
      connections: [
        {
          id: 'tg-1',
          provider: 'telegram',
          label: 'My Telegram',
          status: 'paused',
          enabled: false,
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T12:00:00Z',
        },
      ],
      bindings: [],
    });
    updateGatewayConnectionMock.mockResolvedValue(pausedState);

    const { container } = renderPage();
    await flushAsyncWork();

    const pauseBtn = Array.from(container.querySelectorAll('button')).find((btn) => btn.textContent?.trim() === 'Pause');
    expect(pauseBtn).toBeTruthy();

    click(pauseBtn!);
    await flushAsyncWork();

    expect(updateGatewayConnectionMock).toHaveBeenCalledWith('telegram', { status: 'paused', enabled: false });
  });

  it('resumes Telegram via updateGatewayConnection', async () => {
    const pausedState = createGatewayState({
      connections: [
        {
          id: 'tg-1',
          provider: 'telegram',
          label: 'My Telegram',
          status: 'paused',
          enabled: false,
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T12:00:00Z',
        },
      ],
      bindings: [
        {
          id: 'b-tg-1',
          provider: 'telegram',
          connectionId: 'tg-1',
          conversationId: 'conv-abc',
          conversationTitle: 'Telegram Chat',
          externalChatId: 'chat-123',
          externalChatLabel: 'My Chat',
          repliesEnabled: true,
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T12:00:00Z',
        },
      ],
    });
    gatewaysMock.mockResolvedValue(pausedState);

    const activeState = createGatewayState({
      connections: [
        {
          id: 'tg-1',
          provider: 'telegram',
          label: 'My Telegram',
          status: 'active',
          enabled: true,
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T12:00:00Z',
        },
      ],
      bindings: [],
    });
    updateGatewayConnectionMock.mockResolvedValue(activeState);

    const { container } = renderPage();
    await flushAsyncWork();

    const resumeBtn = Array.from(container.querySelectorAll('button')).find((btn) => btn.textContent?.trim() === 'Resume');
    expect(resumeBtn).toBeTruthy();

    click(resumeBtn!);
    await flushAsyncWork();

    expect(updateGatewayConnectionMock).toHaveBeenCalledWith('telegram', { status: 'active', enabled: true });
  });

  it('detaches Telegram binding', async () => {
    const connectedState = createGatewayState({
      connections: [
        {
          id: 'tg-1',
          provider: 'telegram',
          label: 'My Telegram',
          status: 'active',
          enabled: true,
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T12:00:00Z',
        },
      ],
      bindings: [
        {
          id: 'b-tg-1',
          provider: 'telegram',
          connectionId: 'tg-1',
          conversationId: 'conv-abc',
          conversationTitle: 'Telegram Chat',
          externalChatId: 'chat-123',
          externalChatLabel: 'My Chat',
          repliesEnabled: true,
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T12:00:00Z',
        },
      ],
    });
    gatewaysMock.mockResolvedValue(connectedState);

    const detachedState = createGatewayState({
      connections: [
        {
          id: 'tg-1',
          provider: 'telegram',
          label: 'My Telegram',
          status: 'active',
          enabled: true,
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T12:00:00Z',
        },
      ],
      bindings: [],
    });
    detachGatewayConversationMock.mockResolvedValue(detachedState);

    const { container } = renderPage();
    await flushAsyncWork();

    const detachBtn = Array.from(container.querySelectorAll('button')).find((btn) => btn.textContent?.trim() === 'Detach');
    expect(detachBtn).toBeTruthy();

    click(detachBtn!);
    await flushAsyncWork();

    expect(detachGatewayConversationMock).toHaveBeenCalledWith('conv-abc', 'telegram');
  });

  it('searches Slack channels', async () => {
    const emptyState = createGatewayState();
    gatewaysMock.mockResolvedValue(emptyState);
    searchSlackMcpChannelsMock.mockResolvedValue({
      channels: [
        { id: 'C001', name: 'general' },
        { id: 'C002', name: 'random' },
      ],
    });

    const { container } = renderPage();
    await flushAsyncWork();

    const input = container.querySelector<HTMLInputElement>('input[placeholder="Search channels…"]');
    expect(input).toBeTruthy();

    typeInput(input!, '#general');
    keyDown(input!, 'Enter');
    await flushAsyncWork();

    expect(searchSlackMcpChannelsMock).toHaveBeenCalledWith('#general');
    expect(container.textContent).toContain('general');
    expect(container.textContent).toContain('C001');
    expect(container.textContent).toContain('random');
  });

  it('attaches a Slack channel from search results', async () => {
    const emptyState = createGatewayState();
    gatewaysMock.mockResolvedValue(emptyState);
    searchSlackMcpChannelsMock.mockResolvedValue({
      channels: [{ id: 'C001', name: 'general' }],
    });

    const connectedState = createGatewayState({
      connections: [
        {
          id: 'sl-1',
          provider: 'slack_mcp',
          label: 'Slack Workspace',
          status: 'active',
          enabled: true,
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T12:00:00Z',
        },
      ],
      bindings: [
        {
          id: 'b-sl-1',
          provider: 'slack_mcp',
          connectionId: 'sl-1',
          conversationId: 'conv-def',
          conversationTitle: 'Slack Thread',
          externalChatId: 'C001',
          externalChatLabel: 'general',
          repliesEnabled: true,
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T12:00:00Z',
        },
      ],
    });
    attachSlackMcpChannelMock.mockResolvedValue(connectedState);

    const { container } = renderPage();
    await flushAsyncWork();

    const input = container.querySelector<HTMLInputElement>('input[placeholder="Search channels…"]');
    typeInput(input!, 'general');
    keyDown(input!, 'Enter');
    await flushAsyncWork();

    const channelBtn = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent?.trim() === 'general' || btn.textContent?.includes('C001'),
    );
    expect(channelBtn).toBeTruthy();

    click(channelBtn!);
    await flushAsyncWork();

    expect(attachSlackMcpChannelMock).toHaveBeenCalledWith({
      channelId: 'C001',
      channelLabel: 'general',
    });
    expect(container.textContent).toContain('Slack MCP');
  });

  it('renders recent activity events', async () => {
    gatewaysMock.mockResolvedValue(
      createGatewayState({
        connections: [
          {
            id: 'tg-1',
            provider: 'telegram',
            label: 'My Telegram',
            status: 'active',
            enabled: true,
            createdAt: '2026-05-04T00:00:00Z',
            updatedAt: '2026-05-04T12:00:00Z',
          },
        ],
        bindings: [
          {
            id: 'b-tg-1',
            provider: 'telegram',
            connectionId: 'tg-1',
            conversationId: 'conv-abc',
            conversationTitle: 'Telegram Chat',
            externalChatId: 'chat-123',
            externalChatLabel: 'My Chat',
            repliesEnabled: true,
            createdAt: '2026-05-04T00:00:00Z',
            updatedAt: '2026-05-04T12:00:00Z',
          },
        ],
        events: [
          {
            id: 'evt-1',
            provider: 'telegram',
            conversationId: 'conv-abc',
            kind: 'inbound',
            message: 'Received message from user',
            createdAt: '2026-05-04T12:00:00Z',
          },
          {
            id: 'evt-2',
            provider: 'telegram',
            kind: 'outbound',
            message: 'Replied to user',
            createdAt: '2026-05-04T11:00:00Z',
          },
        ],
      }),
    );
    const { container } = renderPage();
    await flushAsyncWork();

    expect(container.textContent).toContain('Recent activity');
    expect(container.textContent).toContain('Received message from user');
    expect(container.textContent).toContain('Replied to user');
    expect(container.textContent).toContain('Inbound');
    expect(container.textContent).toContain('Outbound');
  });

  it('shows no activity message when events are empty', async () => {
    gatewaysMock.mockResolvedValue(createGatewayState());
    const { container } = renderPage();
    await flushAsyncWork();

    expect(container.textContent).toContain('Recent activity');
    expect(container.textContent).toContain('No activity yet');
  });
});
