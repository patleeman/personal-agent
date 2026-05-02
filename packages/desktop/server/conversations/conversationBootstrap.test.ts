import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildAppendOnlySessionDetailResponseMock,
  listAllLiveSessionsMock,
  readConversationSessionSignatureMock,
  readSessionDetailForRouteMock,
  toPublicLiveSessionMetaMock,
} = vi.hoisted(() => ({
  buildAppendOnlySessionDetailResponseMock: vi.fn(),
  listAllLiveSessionsMock: vi.fn(),
  readConversationSessionSignatureMock: vi.fn(),
  readSessionDetailForRouteMock: vi.fn(),
  toPublicLiveSessionMetaMock: vi.fn(),
}));

vi.mock('./conversationService.js', () => ({
  listAllLiveSessions: listAllLiveSessionsMock,
  readConversationSessionSignature: readConversationSessionSignatureMock,
  readSessionDetailForRoute: readSessionDetailForRouteMock,
  toPublicLiveSessionMeta: toPublicLiveSessionMetaMock,
}));

vi.mock('./sessions.js', () => ({
  buildAppendOnlySessionDetailResponse: buildAppendOnlySessionDetailResponseMock,
}));

import { isMissingConversationBootstrapState, readConversationBootstrapState } from './conversationBootstrap.js';

describe('conversationBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAllLiveSessionsMock.mockReturnValue([]);
    readConversationSessionSignatureMock.mockReturnValue(undefined);
    readSessionDetailForRouteMock.mockResolvedValue({
      sessionRead: {
        detail: null,
        telemetry: null,
      },
      remoteMirror: { status: 'missing', durationMs: 0 },
    });
    toPublicLiveSessionMetaMock.mockReturnValue({ id: 'conversation-1', title: 'Live title' });
    buildAppendOnlySessionDetailResponseMock.mockReturnValue(null);
  });

  it('reuses the known session signature when the transcript is unchanged', async () => {
    readConversationSessionSignatureMock.mockReturnValueOnce('sig-1');
    listAllLiveSessionsMock.mockReturnValueOnce([{ id: 'conversation-1', raw: true }]);

    const result = await readConversationBootstrapState({
      conversationId: 'conversation-1',
      profile: 'assistant',
      knownSessionSignature: 'sig-1',
    });

    expect(readSessionDetailForRouteMock).not.toHaveBeenCalled();
    expect(toPublicLiveSessionMetaMock).toHaveBeenCalledWith({ id: 'conversation-1', raw: true });
    expect(result).toEqual({
      state: {
        conversationId: 'conversation-1',
        sessionDetail: null,
        sessionDetailSignature: 'sig-1',
        sessionDetailUnchanged: true,
        liveSession: {
          live: true,
          id: 'conversation-1',
          title: 'Live title',
        },
      },
      telemetry: {
        sessionRead: null,
        sessionDetailReused: true,
        remoteMirror: { status: 'deferred', durationMs: 0 },
      },
    });
  });

  it('returns append-only state when the cached signature is stale', async () => {
    readConversationSessionSignatureMock.mockReturnValueOnce('sig-new');
    readSessionDetailForRouteMock.mockResolvedValueOnce({
      sessionRead: {
        detail: {
          signature: 'sig-new',
          blocks: [{ id: 'block-2' }],
        },
        telemetry: { cache: 'miss', loader: 'full', durationMs: 4 },
      },
      remoteMirror: { status: 'deferred', durationMs: 0 },
    });
    buildAppendOnlySessionDetailResponseMock.mockReturnValueOnce({
      appendOnly: true,
      signature: 'sig-append',
      blocks: [{ id: 'block-2' }],
    });

    const result = await readConversationBootstrapState({
      conversationId: 'conversation-1',
      profile: 'assistant',
      knownSessionSignature: 'sig-old',
      knownBlockOffset: 3,
      knownTotalBlocks: 9,
      knownLastBlockId: 'block-1',
    });

    expect(buildAppendOnlySessionDetailResponseMock).toHaveBeenCalledWith({
      detail: {
        signature: 'sig-new',
        blocks: [{ id: 'block-2' }],
      },
      knownBlockOffset: 3,
      knownTotalBlocks: 9,
      knownLastBlockId: 'block-1',
    });
    expect(result.state).toEqual({
      conversationId: 'conversation-1',
      sessionDetail: null,
      sessionDetailSignature: 'sig-append',
      sessionDetailAppendOnly: {
        appendOnly: true,
        signature: 'sig-append',
        blocks: [{ id: 'block-2' }],
      },
      liveSession: { live: false },
    });
  });

  it('detects when the bootstrap state is missing entirely', () => {
    expect(
      isMissingConversationBootstrapState({
        conversationId: 'missing',
        sessionDetail: null,
        liveSession: { live: false },
      }),
    ).toBe(true);

    expect(
      isMissingConversationBootstrapState({
        conversationId: 'live',
        sessionDetail: null,
        liveSession: { live: true, id: 'live' },
      }),
    ).toBe(false);
  });
});
