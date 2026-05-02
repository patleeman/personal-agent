import { describe, expect, it, vi } from 'vitest';

vi.mock('./conversationAutoTitle.js', () => ({
  generateConversationTitle: vi.fn(),
  hasAssistantTitleSourceMessage: vi.fn(),
}));

vi.mock('./liveSessionTitle.js', () => ({
  getSessionMessages: vi.fn(),
}));

import * as autoTitle from './conversationAutoTitle.js';
import { requestLiveSessionAutoTitle } from './liveSessionAutoTitleOps.js';
import * as sessionTitle from './liveSessionTitle.js';

function createEntry(overrides?: Record<string, unknown>) {
  return {
    sessionId: 'test-session-1',
    session: {
      sessionName: '',
      modelRegistry: {} as any,
    },
    autoTitleRequested: false,
    ...overrides,
  } as any;
}

describe('requestLiveSessionAutoTitle', () => {
  it('returns early if already requested', () => {
    const entry = createEntry({ autoTitleRequested: true });
    const applyTitle = vi.fn();
    requestLiveSessionAutoTitle({ entry, settingsFile: '/tmp/settings.json', isCurrent: () => true, applyTitle });
    expect(autoTitle.hasAssistantTitleSourceMessage).not.toHaveBeenCalled();
    expect(applyTitle).not.toHaveBeenCalled();
  });

  it('returns early if session already has a name', () => {
    const entry = createEntry({ session: { sessionName: 'My Title' } });
    const applyTitle = vi.fn();
    requestLiveSessionAutoTitle({ entry, settingsFile: '/tmp/settings.json', isCurrent: () => true, applyTitle });
    expect(entry.autoTitleRequested).toBe(true);
    expect(autoTitle.hasAssistantTitleSourceMessage).not.toHaveBeenCalled();
  });

  it('returns early if no assistant message exists', () => {
    vi.mocked(autoTitle.hasAssistantTitleSourceMessage).mockReturnValue(false);
    vi.mocked(sessionTitle.getSessionMessages).mockReturnValue([]);
    const entry = createEntry();
    const applyTitle = vi.fn();
    requestLiveSessionAutoTitle({ entry, settingsFile: '/tmp/settings.json', isCurrent: () => true, applyTitle });
    expect(autoTitle.hasAssistantTitleSourceMessage).toHaveBeenCalled();
    expect(autoTitle.generateConversationTitle).not.toHaveBeenCalled();
    expect(entry.autoTitleRequested).toBe(false);
  });

  it('generates title and applies it when ready', async () => {
    vi.mocked(autoTitle.hasAssistantTitleSourceMessage).mockReturnValue(true);
    vi.mocked(sessionTitle.getSessionMessages).mockReturnValue([{ role: 'user', content: 'hello' }]);
    vi.mocked(autoTitle.generateConversationTitle).mockResolvedValue('Generated Title');

    const entry = createEntry();
    const applyTitle = vi.fn();
    requestLiveSessionAutoTitle({ entry, settingsFile: '/tmp/settings.json', isCurrent: () => true, applyTitle });

    expect(entry.autoTitleRequested).toBe(true);
    expect(autoTitle.generateConversationTitle).toHaveBeenCalled();

    // Wait for the async promise to resolve
    (await vi.dynamicImportSettled?.()) ?? new Promise(setImmediate);

    // Wait a tick for the .then to fire
    await new Promise((r) => setTimeout(r, 0));

    expect(applyTitle).toHaveBeenCalledWith('Generated Title');
  });

  it('does not apply title if session is no longer current', async () => {
    vi.mocked(autoTitle.hasAssistantTitleSourceMessage).mockReturnValue(true);
    vi.mocked(sessionTitle.getSessionMessages).mockReturnValue([{ role: 'user', content: 'hello' }]);
    vi.mocked(autoTitle.generateConversationTitle).mockResolvedValue('Stale Title');

    const entry = createEntry();
    const applyTitle = vi.fn();
    requestLiveSessionAutoTitle({ entry, settingsFile: '/tmp/settings.json', isCurrent: () => false, applyTitle });

    await new Promise((r) => setTimeout(r, 10));
    expect(applyTitle).not.toHaveBeenCalled();
  });

  it('does not apply title if session was named in the meantime', async () => {
    vi.mocked(autoTitle.hasAssistantTitleSourceMessage).mockReturnValue(true);
    vi.mocked(sessionTitle.getSessionMessages).mockReturnValue([{ role: 'user', content: 'hello' }]);
    vi.mocked(autoTitle.generateConversationTitle).mockResolvedValue('Tardy Title');

    const entry = createEntry();
    const applyTitle = vi.fn();
    requestLiveSessionAutoTitle({ entry, settingsFile: '/tmp/settings.json', isCurrent: () => true, applyTitle });

    // Add a name before the promise resolves
    entry.session.sessionName = 'Manual Name';

    await new Promise((r) => setTimeout(r, 10));
    expect(applyTitle).not.toHaveBeenCalled();
    // autoTitleRequested stays true since session already named
    expect(entry.autoTitleRequested).toBe(true);
  });
});
