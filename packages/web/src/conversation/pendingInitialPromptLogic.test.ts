import { describe, expect, it } from 'vitest';
import type { PendingConversationPrompt } from '../pending/pendingConversationPrompt';
import {
  hasConversationTranscriptAcceptedPendingInitialPrompt,
  normalizePendingRelatedConversationIds,
  pendingPromptImagesMatchMessageImages,
  shouldAutoDispatchPendingInitialPrompt,
  shouldClaimPendingInitialPromptForSession,
  shouldKeepStoredPendingInitialPromptDuringDispatch,
} from './pendingInitialPromptLogic';

const prompt: PendingConversationPrompt = {
  text: 'Ship it',
  images: [],
  attachmentRefs: [],
};

describe('pendingInitialPromptLogic', () => {
  it('only auto-dispatches pending initial prompts for live conversation snapshots', () => {
    expect(shouldAutoDispatchPendingInitialPrompt({
      draft: false,
      conversationId: 'session-1',
      hasPendingInitialPrompt: true,
      pendingInitialPromptDispatching: false,
      hasStreamSnapshot: true,
      hasTranscriptMessages: false,
    })).toBe(true);

    expect(shouldAutoDispatchPendingInitialPrompt({
      draft: true,
      conversationId: 'session-1',
      hasPendingInitialPrompt: true,
      pendingInitialPromptDispatching: false,
      hasStreamSnapshot: true,
      hasTranscriptMessages: false,
    })).toBe(false);
    expect(shouldAutoDispatchPendingInitialPrompt({
      draft: false,
      conversationId: null,
      hasPendingInitialPrompt: true,
      pendingInitialPromptDispatching: false,
      hasStreamSnapshot: true,
      hasTranscriptMessages: false,
    })).toBe(false);
    expect(shouldAutoDispatchPendingInitialPrompt({
      draft: false,
      conversationId: 'session-1',
      hasPendingInitialPrompt: true,
      pendingInitialPromptDispatching: true,
      hasStreamSnapshot: true,
      hasTranscriptMessages: false,
    })).toBe(false);
    expect(shouldAutoDispatchPendingInitialPrompt({
      draft: false,
      conversationId: 'session-1',
      hasPendingInitialPrompt: true,
      pendingInitialPromptDispatching: false,
      hasStreamSnapshot: true,
      hasTranscriptMessages: true,
    })).toBe(false);
  });

  it('claims a pending initial prompt once per non-failed session', () => {
    expect(shouldClaimPendingInitialPromptForSession({
      conversationId: 'session-1',
      prompt,
      inFlightSessionId: null,
      failedSessionId: null,
    })).toBe(true);

    expect(shouldClaimPendingInitialPromptForSession({
      conversationId: 'session-1',
      prompt,
      inFlightSessionId: 'session-1',
      failedSessionId: null,
    })).toBe(false);
    expect(shouldClaimPendingInitialPromptForSession({
      conversationId: 'session-1',
      prompt,
      inFlightSessionId: null,
      failedSessionId: 'session-1',
    })).toBe(false);
    expect(shouldClaimPendingInitialPromptForSession({
      conversationId: undefined,
      prompt,
      inFlightSessionId: null,
      failedSessionId: null,
    })).toBe(false);
  });

  it('keeps stored prompts while related-thread context is being prepared', () => {
    expect(shouldKeepStoredPendingInitialPromptDuringDispatch(prompt)).toBe(false);
    expect(shouldKeepStoredPendingInitialPromptDuringDispatch({
      ...prompt,
      relatedConversationIds: ['related-1'],
    })).toBe(true);
  });

  it('normalizes related conversation ids before dispatching', () => {
    expect(normalizePendingRelatedConversationIds({
      ...prompt,
      relatedConversationIds: [' related-1 ', '', 'related-2', 'related-1'],
    })).toEqual(['related-1', 'related-2']);
  });

  it('detects transcript acceptance by text and matching image identity', () => {
    expect(hasConversationTranscriptAcceptedPendingInitialPrompt({
      prompt: { ...prompt, images: [{ data: 'abc', mimeType: 'image/png', name: 'ship.png', previewUrl: 'blob:ship' }] },
      messages: [{ type: 'user', ts: '2026-01-01T00:00:00.000Z', text: 'Ship it', images: [{ alt: 'ship.png', src: 'blob:ship', mimeType: 'image/png', caption: 'ship.png' }] }],
    })).toBe(true);

    expect(hasConversationTranscriptAcceptedPendingInitialPrompt({
      prompt: { ...prompt, images: [{ data: 'abc', mimeType: 'image/png', name: 'ship.png', previewUrl: 'blob:ship' }] },
      messages: [{ type: 'user', ts: '2026-01-01T00:00:00.000Z', text: 'Ship it', images: [{ alt: 'other.png', src: 'blob:other', mimeType: 'image/png', caption: 'other.png' }] }],
    })).toBe(false);

    expect(hasConversationTranscriptAcceptedPendingInitialPrompt({
      prompt,
      messages: [{ type: 'user', ts: '2026-01-01T00:00:00.000Z', text: 'Different' }],
    })).toBe(false);
  });

  it('falls back to image metadata when pending preview urls are unavailable', () => {
    expect(pendingPromptImagesMatchMessageImages(
      [{ data: 'abc', mimeType: 'image/png', name: 'ship.png' }],
      [{ alt: 'ship.png', mimeType: 'image/png', caption: 'ship.png' }],
    )).toBe(true);

    expect(pendingPromptImagesMatchMessageImages(
      [{ data: 'abc', mimeType: 'image/png', name: 'ship.png' }],
      [{ alt: 'other.png', mimeType: 'image/png', caption: 'other.png' }],
    )).toBe(false);
  });

  it('matches accepted transcript images by data url when pending previews used blob urls', () => {
    expect(pendingPromptImagesMatchMessageImages(
      [{ data: 'abc', mimeType: 'image/png', name: 'ship.png', previewUrl: 'blob:ship' }],
      [{ alt: 'ship.png', src: 'data:image/png;base64,abc', mimeType: 'image/png', caption: 'ship.png' }],
    )).toBe(true);
  });
});
