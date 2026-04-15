import React from 'react';
import { parseFragment } from 'parse5';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableRunRecord, MessageBlock, SessionMeta } from '../types.js';
import {
  ConversationPage,
  buildConversationBackgroundRunIndicatorText,
  formatConversationBackgroundRunStatusLabel,
  mergeConversationSessionMeta,
  replaceConversationTitleInSessionList,
  isConversationSessionNotLiveError,
  resolveConversationLiveSession,
  resolveConversationPageTitle,
  resolveConversationPendingStatusLabel,
  resolveDisplayedConversationPendingStatusLabel,
  resolveConversationStreamTitleSync,
  resolveConversationAutocompleteCatalogDemand,
  shouldEnableConversationLiveStream,
  shouldShowConversationTakeoverBanner,
  shouldShowMissingConversationState,
  shouldAutoDispatchPendingInitialPrompt,
  hasConversationTranscriptAcceptedPendingInitialPrompt,
  shouldDeferConversationFileRefresh,
  shouldFetchConversationLiveSessionGitContext,
  shouldLoadConversationModels,
  truncateConversationShelfText,
  formatQueuedPromptShelfText,
  formatQueuedPromptImageSummary,
  resolveConversationInitialHistoricalWarmupTarget,
  hasConversationLoadedHistoricalTailBlocks,
  shouldShowConversationInitialHistoricalWarmupLoader,
  shouldShowConversationBootstrapLoadingState,
  shouldUseHealthyDesktopConversationState,
  shouldShowConversationInlineLoadingState,
  shouldFetchConversationAttachments,
  resolveConversationVisibleScrollBinding,
  buildConversationInitialModelPreferenceState,
  resolveConversationComposerShellStateClassName,
  resolveConversationInitialModelPreferenceState,
  resolveConversationInitialDeferredResumeState,
  resolveConversationDraftHydrationState,
  resolveConversationGitSummaryPresentation,
  resolveRelatedThreadHotkeyIndex,
} from './ConversationPage.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

type ParsedNode = {
  nodeName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ParsedNode[];
  parentNode?: ParsedNode | null;
};

function getNodeClassList(node: ParsedNode): string[] {
  const value = node.attrs?.find((attr) => attr.name === 'class')?.value ?? '';
  return value.split(/\s+/).filter(Boolean);
}

function findFirstNodeByClass(node: ParsedNode, className: string): ParsedNode | null {
  if (getNodeClassList(node).includes(className)) {
    return node;
  }

  for (const child of node.childNodes ?? []) {
    const match = findFirstNodeByClass(child, className);
    if (match) {
      return match;
    }
  }

  return null;
}

function hasAncestorWithClass(node: ParsedNode | null | undefined, className: string): boolean {
  let current = node?.parentNode ?? null;
  while (current) {
    if (getNodeClassList(current).includes(className)) {
      return true;
    }
    current = current.parentNode ?? null;
  }
  return false;
}

function createBackgroundRun(overrides: Partial<DurableRunRecord> = {}): DurableRunRecord {
  return {
    runId: 'run-background-123',
    paths: {
      root: '/tmp/run-background-123',
      manifestPath: '/tmp/run-background-123/manifest.json',
      statusPath: '/tmp/run-background-123/status.json',
      checkpointPath: '/tmp/run-background-123/checkpoint.json',
      eventsPath: '/tmp/run-background-123/events.jsonl',
      outputLogPath: '/tmp/run-background-123/output.log',
      resultPath: '/tmp/run-background-123/result.json',
    },
    manifest: {
      version: 1,
      id: 'run-background-123',
      kind: 'background-run',
      resumePolicy: 'manual',
      createdAt: '2026-03-29T00:00:00.000Z',
      spec: {
        taskSlug: 'deploy-check',
        shellCommand: 'npm run deploy:check',
      },
      source: {
        type: 'tool',
        id: 'conv-123',
      },
    },
    status: {
      version: 1,
      runId: 'run-background-123',
      status: 'running',
      createdAt: '2026-03-29T00:00:00.000Z',
      updatedAt: '2026-03-29T00:01:00.000Z',
      activeAttempt: 1,
      startedAt: '2026-03-29T00:00:10.000Z',
    },
    checkpoint: {
      version: 1,
      runId: 'run-background-123',
      updatedAt: '2026-03-29T00:01:00.000Z',
      step: 'running',
      payload: {},
    },
    problems: [],
    recoveryAction: 'none',
    ...overrides,
  };
}

describe('related thread hotkeys', () => {
  it('accepts Ctrl+digit via event.code for the first 9 threads', () => {
    expect(resolveRelatedThreadHotkeyIndex({
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      key: '1',
      code: 'Digit1',
      isComposing: false,
    })).toBe(0);

    expect(resolveRelatedThreadHotkeyIndex({
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      key: '9',
      code: 'Digit9',
      isComposing: false,
    })).toBe(8);
  });

  it('falls back to the raw key when event.code is unavailable', () => {
    expect(resolveRelatedThreadHotkeyIndex({
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      key: '4',
      code: '',
      isComposing: false,
    })).toBe(3);
  });

  it('ignores non-Ctrl and modified key combinations', () => {
    expect(resolveRelatedThreadHotkeyIndex({
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      key: '1',
      code: 'Digit1',
      isComposing: false,
    })).toBe(-1);

    expect(resolveRelatedThreadHotkeyIndex({
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: true,
      key: '!',
      code: 'Digit1',
      isComposing: false,
    })).toBe(-1);
  });
});

describe('conversation autocomplete catalog demand', () => {
  it('skips memory and vault catalog reads for plain prompts', () => {
    expect(resolveConversationAutocompleteCatalogDemand('Write a git commit message for this diff.')).toEqual({
      needsMemoryData: false,
      needsVaultFiles: false,
    });
  });

  it('loads memory data for slash command discovery but skips vault files', () => {
    expect(resolveConversationAutocompleteCatalogDemand('/resume 10m')).toEqual({
      needsMemoryData: true,
      needsVaultFiles: false,
    });
  });

  it('loads both catalogs for mention discovery but not for the model picker', () => {
    expect(resolveConversationAutocompleteCatalogDemand('@agent-browser')).toEqual({
      needsMemoryData: true,
      needsVaultFiles: true,
    });
    expect(resolveConversationAutocompleteCatalogDemand('/model claude')).toEqual({
      needsMemoryData: false,
      needsVaultFiles: false,
    });
  });
});

describe('desktop conversation state fallback', () => {
  it('uses the dedicated desktop state only while the local subscription is healthy', () => {
    expect(shouldUseHealthyDesktopConversationState({
      draft: false,
      conversationId: 'conv-123',
      desktopMode: 'local',
      desktopError: null,
    })).toBe(true);

    expect(shouldUseHealthyDesktopConversationState({
      draft: false,
      conversationId: 'conv-123',
      desktopMode: 'local',
      desktopError: 'Conversation state subscription failed.',
    })).toBe(false);

    expect(shouldUseHealthyDesktopConversationState({
      draft: false,
      conversationId: 'conv-123',
      desktopMode: 'checking',
      desktopError: null,
    })).toBe(false);

    expect(shouldUseHealthyDesktopConversationState({
      draft: true,
      conversationId: 'conv-123',
      desktopMode: 'local',
      desktopError: null,
    })).toBe(false);
  });
});

describe('conversation initial deferred resume state', () => {
  it('only reuses carried deferred resumes for the matching non-draft conversation route', () => {
    expect(resolveConversationInitialDeferredResumeState({
      draft: false,
      conversationId: 'conv-123',
      locationState: {
        initialDeferredResumeState: {
          conversationId: 'conv-123',
          resumes: [],
        },
      },
    })).toEqual([]);

    expect(resolveConversationInitialDeferredResumeState({
      draft: true,
      conversationId: 'conv-123',
      locationState: {
        initialDeferredResumeState: {
          conversationId: 'conv-123',
          resumes: [],
        },
      },
    })).toBeNull();

    expect(resolveConversationInitialDeferredResumeState({
      draft: false,
      conversationId: 'conv-456',
      locationState: {
        initialDeferredResumeState: {
          conversationId: 'conv-123',
          resumes: [],
        },
      },
    })).toBeNull();
  });
});

describe('conversation draft hydration state', () => {
  it('only reuses carried draft hydration state for the matching non-draft conversation route', () => {
    expect(resolveConversationDraftHydrationState({
      draft: false,
      conversationId: 'conv-123',
      locationState: {
        draftHydrationState: {
          conversationId: 'conv-123',
          enableAutoModeOnLoad: true,
        },
      },
    })).toEqual({
      conversationId: 'conv-123',
      enableAutoModeOnLoad: true,
    });

    expect(resolveConversationDraftHydrationState({
      draft: true,
      conversationId: 'conv-123',
      locationState: {
        draftHydrationState: {
          conversationId: 'conv-123',
          enableAutoModeOnLoad: true,
        },
      },
    })).toBeNull();

    expect(resolveConversationDraftHydrationState({
      draft: false,
      conversationId: 'conv-456',
      locationState: {
        draftHydrationState: {
          conversationId: 'conv-123',
          enableAutoModeOnLoad: true,
        },
      },
    })).toBeNull();
  });
});

describe('conversation initial model preference state', () => {
  it('carries the current draft model preferences forward for a just-created conversation', () => {
    expect(buildConversationInitialModelPreferenceState({
      conversationId: 'conv-123',
      currentModel: 'anthropic/claude-sonnet-4-6',
      currentThinkingLevel: 'medium',
      currentServiceTier: '',
      defaultModel: 'openai/gpt-5.4',
      defaultThinkingLevel: 'high',
      defaultServiceTier: '',
    })).toEqual({
      conversationId: 'conv-123',
      currentModel: 'anthropic/claude-sonnet-4-6',
      currentThinkingLevel: 'medium',
      currentServiceTier: '',
    });
  });

  it('falls back to defaults when the carried state is blank', () => {
    expect(buildConversationInitialModelPreferenceState({
      conversationId: 'conv-123',
      currentModel: '   ',
      currentThinkingLevel: '',
      currentServiceTier: '',
      defaultModel: 'openai/gpt-5.4',
      defaultThinkingLevel: 'high',
      defaultServiceTier: '',
    })).toEqual({
      conversationId: 'conv-123',
      currentModel: 'openai/gpt-5.4',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
    });
  });

  it('only reuses carried state for the matching non-draft conversation route', () => {
    expect(resolveConversationInitialModelPreferenceState({
      draft: false,
      conversationId: 'conv-123',
      locationState: {
        initialModelPreferenceState: {
          conversationId: 'conv-123',
          currentModel: 'anthropic/claude-sonnet-4-6',
          currentThinkingLevel: 'medium',
          currentServiceTier: '',
        },
      },
      defaultModel: 'openai/gpt-5.4',
      defaultThinkingLevel: 'high',
      defaultServiceTier: '',
    })).toEqual({
      conversationId: 'conv-123',
      currentModel: 'anthropic/claude-sonnet-4-6',
      currentThinkingLevel: 'medium',
      currentServiceTier: '',
    });

    expect(resolveConversationInitialModelPreferenceState({
      draft: true,
      conversationId: 'conv-123',
      locationState: {
        initialModelPreferenceState: {
          conversationId: 'conv-123',
          currentModel: 'anthropic/claude-sonnet-4-6',
          currentThinkingLevel: 'medium',
          currentServiceTier: '',
        },
      },
      defaultModel: 'openai/gpt-5.4',
      defaultThinkingLevel: 'high',
      defaultServiceTier: '',
    })).toBeNull();

    expect(resolveConversationInitialModelPreferenceState({
      draft: false,
      conversationId: 'conv-456',
      locationState: {
        initialModelPreferenceState: {
          conversationId: 'conv-123',
          currentModel: 'anthropic/claude-sonnet-4-6',
          currentThinkingLevel: 'medium',
          currentServiceTier: '',
        },
      },
      defaultModel: 'openai/gpt-5.4',
      defaultThinkingLevel: 'high',
      defaultServiceTier: '',
    })).toBeNull();
  });
});

describe('conversation attachment fetch gating', () => {
  it('only loads saved conversation attachments when the drawings picker is actually open', () => {
    expect(shouldFetchConversationAttachments({
      draft: true,
      conversationId: 'conv-123',
      drawingsPickerOpen: true,
    })).toBe(false);

    expect(shouldFetchConversationAttachments({
      draft: false,
      conversationId: null,
      drawingsPickerOpen: true,
    })).toBe(false);

    expect(shouldFetchConversationAttachments({
      draft: false,
      conversationId: 'conv-123',
      drawingsPickerOpen: false,
    })).toBe(false);

    expect(shouldFetchConversationAttachments({
      draft: false,
      conversationId: 'conv-123',
      drawingsPickerOpen: true,
    })).toBe(true);
  });
});

describe('conversation model loading', () => {
  it('keeps draft model data hot even before a session exists', () => {
    expect(shouldLoadConversationModels({
      draft: true,
      hasPendingInitialPrompt: false,
      hasPendingInitialPromptInFlight: false,
    })).toBe(true);
  });

  it('defers model reads while the initial prompt is still pending or in flight', () => {
    expect(shouldLoadConversationModels({
      draft: false,
      hasPendingInitialPrompt: true,
      hasPendingInitialPromptInFlight: false,
    })).toBe(false);

    expect(shouldLoadConversationModels({
      draft: false,
      hasPendingInitialPrompt: false,
      hasPendingInitialPromptInFlight: true,
    })).toBe(false);
  });

  it('loads model data once the initial prompt work is clear', () => {
    expect(shouldLoadConversationModels({
      draft: false,
      hasPendingInitialPrompt: false,
      hasPendingInitialPromptInFlight: false,
    })).toBe(true);
  });
});

describe('conversation file refresh deferral', () => {
  it('defers file-backed refreshes while the initial prompt is still pending or in flight', () => {
    expect(shouldDeferConversationFileRefresh({
      draft: false,
      conversationId: 'conv-123',
      hasPendingInitialPrompt: true,
      pendingInitialPromptDispatching: false,
      hasPendingInitialPromptInFlight: false,
    })).toBe(true);

    expect(shouldDeferConversationFileRefresh({
      draft: false,
      conversationId: 'conv-123',
      hasPendingInitialPrompt: false,
      pendingInitialPromptDispatching: true,
      hasPendingInitialPromptInFlight: false,
    })).toBe(true);

    expect(shouldDeferConversationFileRefresh({
      draft: false,
      conversationId: 'conv-123',
      hasPendingInitialPrompt: false,
      pendingInitialPromptDispatching: false,
      hasPendingInitialPromptInFlight: true,
    })).toBe(true);
  });

  it('keeps normal file refreshes enabled once the carried prompt work is clear', () => {
    expect(shouldDeferConversationFileRefresh({
      draft: false,
      conversationId: 'conv-123',
      hasPendingInitialPrompt: false,
      pendingInitialPromptDispatching: false,
      hasPendingInitialPromptInFlight: false,
    })).toBe(false);
  });
});

describe('conversation live-session git context loading', () => {
  it('defers git-context reads while the initial prompt is still pending or in flight', () => {
    expect(shouldFetchConversationLiveSessionGitContext({
      draft: false,
      conversationId: 'conv-123',
      conversationLiveDecision: true,
      conversationBootstrapLoading: false,
      sessionLoading: false,
      isStreaming: false,
      hasPendingInitialPrompt: true,
      pendingInitialPromptDispatching: false,
      hasPendingInitialPromptInFlight: false,
    })).toBe(false);

    expect(shouldFetchConversationLiveSessionGitContext({
      draft: false,
      conversationId: 'conv-123',
      conversationLiveDecision: true,
      conversationBootstrapLoading: false,
      sessionLoading: false,
      isStreaming: false,
      hasPendingInitialPrompt: false,
      pendingInitialPromptDispatching: true,
      hasPendingInitialPromptInFlight: false,
    })).toBe(false);

    expect(shouldFetchConversationLiveSessionGitContext({
      draft: false,
      conversationId: 'conv-123',
      conversationLiveDecision: true,
      conversationBootstrapLoading: false,
      sessionLoading: false,
      isStreaming: false,
      hasPendingInitialPrompt: false,
      pendingInitialPromptDispatching: false,
      hasPendingInitialPromptInFlight: true,
    })).toBe(false);
  });

  it('loads git context once the conversation is live and the initial prompt work is clear', () => {
    expect(shouldFetchConversationLiveSessionGitContext({
      draft: false,
      conversationId: 'conv-123',
      conversationLiveDecision: true,
      conversationBootstrapLoading: false,
      sessionLoading: false,
      isStreaming: false,
      hasPendingInitialPrompt: false,
      pendingInitialPromptDispatching: false,
      hasPendingInitialPromptInFlight: false,
    })).toBe(true);
  });
});

describe('conversation live state helpers', () => {
  it('keeps the live stream enabled until the conversation is confirmed not live', () => {
    expect(shouldEnableConversationLiveStream('conv-123', null)).toBe(true);
    expect(shouldEnableConversationLiveStream('conv-123', true)).toBe(true);
    expect(shouldEnableConversationLiveStream('conv-123', false)).toBe(false);
    expect(shouldEnableConversationLiveStream(null, null)).toBe(false);
  });

  it('treats a conversation as live when either the stream or probe confirms it', () => {
    expect(resolveConversationLiveSession({ streamBlockCount: 0, isStreaming: false, confirmedLive: null })).toBe(false);
    expect(resolveConversationLiveSession({ streamBlockCount: 1, isStreaming: false, confirmedLive: null })).toBe(true);
    expect(resolveConversationLiveSession({ streamBlockCount: 0, isStreaming: true, confirmedLive: null })).toBe(true);
    expect(resolveConversationLiveSession({ streamBlockCount: 0, isStreaming: false, confirmedLive: true })).toBe(true);
  });

  it('recognizes the stale live-session prompt failure from the server', () => {
    expect(isConversationSessionNotLiveError(new Error('Session conv-123 is not live'))).toBe(true);
    expect(isConversationSessionNotLiveError(new Error('Session not live'))).toBe(true);
    expect(isConversationSessionNotLiveError(new Error('Not a live session'))).toBe(true);
    expect(isConversationSessionNotLiveError(new Error('provider unavailable'))).toBe(false);
  });

  it('never shows the removed takeover call-to-action', () => {
    expect(shouldShowConversationTakeoverBanner({ draft: false, isLiveSession: true, conversationNeedsTakeover: true })).toBe(false);
    expect(shouldShowConversationTakeoverBanner({ draft: false, isLiveSession: true, conversationNeedsTakeover: false })).toBe(false);
    expect(shouldShowConversationTakeoverBanner({ draft: true, isLiveSession: true, conversationNeedsTakeover: true })).toBe(false);
    expect(shouldShowConversationTakeoverBanner({ draft: false, isLiveSession: false, conversationNeedsTakeover: true })).toBe(false);
  });

  it('does not show the missing state until session discovery has loaded', () => {
    expect(shouldShowMissingConversationState({
      draft: false,
      conversationId: 'conv-123',
      sessionsLoaded: false,
      confirmedLive: false,
      sessionLoading: false,
      hasVisibleSessionDetail: false,
      hasSavedConversationSessionFile: false,
      hasPendingInitialPrompt: false,
    })).toBe(false);

    expect(shouldShowMissingConversationState({
      draft: false,
      conversationId: 'conv-123',
      sessionsLoaded: true,
      confirmedLive: false,
      sessionLoading: false,
      hasVisibleSessionDetail: false,
      hasSavedConversationSessionFile: false,
      hasPendingInitialPrompt: false,
    })).toBe(true);
  });

  it('skips eager historical warmup so the conversation can open from a small tail first', () => {
    expect(resolveConversationInitialHistoricalWarmupTarget({
      draft: false,
      conversationId: 'conv-123',
      liveDecision: false,
      historicalTotalBlocks: 1500,
      historicalHasOlderBlocks: true,
    })).toBeNull();

    expect(resolveConversationInitialHistoricalWarmupTarget({
      draft: false,
      conversationId: 'conv-123',
      liveDecision: true,
      historicalTotalBlocks: 1500,
      historicalHasOlderBlocks: true,
    })).toBeNull();
  });

  it('keeps the conversation loader up until the warmed historical tail has arrived', () => {
    const detail = {
      blocks: Array.from({ length: 240 }, () => null) as never[],
      totalBlocks: 360,
    };

    expect(hasConversationLoadedHistoricalTailBlocks(detail, 360)).toBe(false);
    expect(shouldShowConversationInitialHistoricalWarmupLoader({
      warmupActive: true,
      targetTailBlocks: 360,
      currentTailBlocks: 360,
      loadedTailBlocks: false,
    })).toBe(true);

    const loadedDetail = {
      ...detail,
      blocks: Array.from({ length: 360 }, () => null) as never[],
    };

    expect(hasConversationLoadedHistoricalTailBlocks(loadedDetail, 360)).toBe(true);
    expect(shouldShowConversationInitialHistoricalWarmupLoader({
      warmupActive: true,
      targetTailBlocks: 360,
      currentTailBlocks: 360,
      loadedTailBlocks: true,
    })).toBe(false);
  });

  it('shows a loading state while the next conversation bootstrap is still fetching', () => {
    expect(shouldShowConversationBootstrapLoadingState({
      draft: false,
      conversationId: 'conv-123',
      conversationBootstrapLoading: true,
      hasRenderableMessages: false,
      hasVisibleSessionDetail: false,
    })).toBe(true);

    expect(shouldShowConversationBootstrapLoadingState({
      draft: false,
      conversationId: 'conv-123',
      conversationBootstrapLoading: false,
      hasRenderableMessages: false,
      hasVisibleSessionDetail: false,
    })).toBe(false);

    expect(shouldShowConversationBootstrapLoadingState({
      draft: false,
      conversationId: 'conv-123',
      conversationBootstrapLoading: true,
      hasRenderableMessages: true,
      hasVisibleSessionDetail: false,
    })).toBe(false);

    expect(shouldShowConversationBootstrapLoadingState({
      draft: false,
      conversationId: 'conv-123',
      conversationBootstrapLoading: true,
      hasRenderableMessages: false,
      hasVisibleSessionDetail: true,
    })).toBe(false);
  });

  it('keeps the current transcript visible while the next one is still loading', () => {
    expect(shouldShowConversationInlineLoadingState({
      showConversationLoadingState: true,
      hasVisibleTranscript: true,
    })).toBe(true);

    expect(shouldShowConversationInlineLoadingState({
      showConversationLoadingState: true,
      hasVisibleTranscript: false,
    })).toBe(false);

    expect(shouldShowConversationInlineLoadingState({
      showConversationLoadingState: false,
      hasVisibleTranscript: true,
    })).toBe(false);
  });

  it('waits to auto-dispatch a pending initial prompt until no background start is in flight', () => {
    expect(shouldAutoDispatchPendingInitialPrompt({
      draft: false,
      conversationId: 'conv-123',
      hasPendingInitialPrompt: true,
      pendingInitialPromptDispatching: false,
      hasStreamSnapshot: true,
    })).toBe(true);

    expect(shouldAutoDispatchPendingInitialPrompt({
      draft: false,
      conversationId: 'conv-123',
      hasPendingInitialPrompt: true,
      pendingInitialPromptDispatching: true,
      hasStreamSnapshot: true,
    })).toBe(false);

    expect(shouldAutoDispatchPendingInitialPrompt({
      draft: false,
      conversationId: 'conv-123',
      hasPendingInitialPrompt: true,
      pendingInitialPromptDispatching: false,
      hasStreamSnapshot: false,
    })).toBe(false);
  });

  it('keeps a detached-start prompt visible until the accepted user turn shows up in the transcript', () => {
    expect(hasConversationTranscriptAcceptedPendingInitialPrompt({
      messages: undefined,
      prompt: {
        text: 'Kick this off',
        images: [],
        attachmentRefs: [],
      },
    })).toBe(false);

    expect(hasConversationTranscriptAcceptedPendingInitialPrompt({
      messages: [{
        type: 'text',
        ts: '2026-04-11T12:00:00.000Z',
        text: 'Working…',
      }],
      prompt: {
        text: 'Kick this off',
        images: [],
        attachmentRefs: [],
      },
    })).toBe(false);

    expect(hasConversationTranscriptAcceptedPendingInitialPrompt({
      messages: [{
        type: 'user',
        ts: '2026-04-11T12:00:01.000Z',
        text: 'Kick this off',
      }],
      prompt: {
        text: 'Kick this off',
        images: [],
        attachmentRefs: [],
      },
    })).toBe(true);
  });

  it('matches image-only detached-start prompts by user image count', () => {
    expect(hasConversationTranscriptAcceptedPendingInitialPrompt({
      messages: [{
        type: 'user',
        ts: '2026-04-11T12:00:01.000Z',
        text: '',
        images: [{ alt: 'Attached image' }],
      }],
      prompt: {
        text: '',
        images: [{
          data: 'abc',
          mimeType: 'image/png',
        }],
        attachmentRefs: [],
      },
    })).toBe(true);

    expect(hasConversationTranscriptAcceptedPendingInitialPrompt({
      messages: [{
        type: 'user',
        ts: '2026-04-11T12:00:01.000Z',
        text: '',
      }],
      prompt: {
        text: '',
        images: [{
          data: 'abc',
          mimeType: 'image/png',
        }],
        attachmentRefs: [],
      },
    })).toBe(false);
  });

  it('binds scroll state to the preserved transcript while a replacement conversation is still loading', () => {
    const preservedMessages: MessageBlock[] = [{
      type: 'text',
      ts: '2026-04-06T10:00:00.000Z',
      text: 'Preserved transcript block',
    }];

    expect(resolveConversationVisibleScrollBinding({
      draft: false,
      routeConversationId: 'conv-next',
      realMessages: undefined,
      stableTranscriptState: {
        conversationId: 'conv-prev',
        messages: preservedMessages,
      },
      showConversationLoadingState: true,
      initialScrollKey: 'conv-next:settled',
      isStreaming: true,
    })).toEqual({
      conversationId: 'conv-prev',
      messages: preservedMessages,
      initialScrollKey: null,
      isStreaming: false,
      usingStableTranscript: true,
    });
  });

  it('keeps scroll state attached to the active transcript once the conversation is ready', () => {
    const realMessages: MessageBlock[] = [{
      type: 'text',
      ts: '2026-04-06T10:01:00.000Z',
      text: 'Fresh transcript block',
    }];

    expect(resolveConversationVisibleScrollBinding({
      draft: false,
      routeConversationId: 'conv-next',
      realMessages,
      stableTranscriptState: {
        conversationId: 'conv-prev',
        messages: [{
          type: 'text',
          ts: '2026-04-06T10:00:00.000Z',
          text: 'Old transcript block',
        }],
      },
      showConversationLoadingState: false,
      initialScrollKey: 'conv-next:settled',
      isStreaming: true,
    })).toEqual({
      conversationId: 'conv-next',
      messages: realMessages,
      initialScrollKey: 'conv-next:settled',
      isStreaming: true,
      usingStableTranscript: false,
    });
  });

  it('chooses an immediate pending status label for outbound prompts', () => {
    expect(resolveConversationPendingStatusLabel({
      isLiveSession: true,
      hasVisibleSessionDetail: true,
    })).toBe('Working…');

    expect(resolveConversationPendingStatusLabel({
      isLiveSession: false,
      hasVisibleSessionDetail: true,
    })).toBe('Resuming…');
  });

  it('keeps showing a pending status while a draft or initial prompt is still staging', () => {
    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: null,
      draft: true,
      hasDraftPendingPrompt: true,
      isStreaming: false,
      hasPendingInitialPrompt: false,
      hasPendingInitialPromptInFlight: false,
      isLiveSession: false,
      hasVisibleSessionDetail: false,
    })).toBe('Sending…');

    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: null,
      draft: false,
      hasDraftPendingPrompt: false,
      isStreaming: false,
      hasPendingInitialPrompt: true,
      hasPendingInitialPromptInFlight: false,
      isLiveSession: true,
      hasVisibleSessionDetail: false,
    })).toBe('Working…');

    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: null,
      draft: false,
      hasDraftPendingPrompt: false,
      isStreaming: false,
      hasPendingInitialPrompt: false,
      hasPendingInitialPromptInFlight: true,
      isLiveSession: true,
      hasVisibleSessionDetail: false,
    })).toBe('Working…');

    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: 'Resuming…',
      draft: false,
      hasDraftPendingPrompt: false,
      isStreaming: false,
      hasPendingInitialPrompt: false,
      hasPendingInitialPromptInFlight: false,
      isLiveSession: false,
      hasVisibleSessionDetail: true,
    })).toBe('Resuming…');

    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: null,
      draft: false,
      hasDraftPendingPrompt: false,
      isStreaming: true,
      hasPendingInitialPrompt: true,
      hasPendingInitialPromptInFlight: true,
      isLiveSession: true,
      hasVisibleSessionDetail: false,
    })).toBeNull();
  });

  it('prefers the freshest available conversation title source', () => {
    expect(resolveConversationPageTitle({
      draft: false,
      titleOverride: 'Manual override',
      streamTitle: 'Live stream title',
      liveTitle: 'Sidebar title',
      detailTitle: 'Stored detail title',
      sessionTitle: 'Session snapshot title',
    })).toBe('Manual override');

    expect(resolveConversationPageTitle({
      draft: false,
      streamTitle: null,
      liveTitle: 'Sidebar title',
      detailTitle: 'Stored detail title',
      sessionTitle: 'Session snapshot title',
    })).toBe('Sidebar title');

    expect(resolveConversationPageTitle({
      draft: false,
      streamTitle: null,
      liveTitle: null,
      detailTitle: 'Stored detail title',
      sessionTitle: 'Session snapshot title',
    })).toBe('Stored detail title');
  });

  it('syncs a refreshed conversation title back into the session list', () => {
    const sessions = [
      { id: 'conv-123', title: 'Old title' },
      { id: 'conv-456', title: 'Other title' },
    ];

    expect(replaceConversationTitleInSessionList(sessions, 'conv-123', '  Better title  ')).toEqual([
      { id: 'conv-123', title: 'Better title' },
      { id: 'conv-456', title: 'Other title' },
    ]);
    expect(replaceConversationTitleInSessionList(sessions, 'conv-123', 'Old title')).toBe(sessions);
    expect(replaceConversationTitleInSessionList(sessions, 'conv-123', '')).toBe(sessions);
  });

  it('pushes live stream titles into shared sidebar state immediately', () => {
    const sessions = [
      { id: 'conv-123', title: 'New Conversation' },
      { id: 'conv-456', title: 'Other title' },
    ];

    expect(resolveConversationStreamTitleSync({
      draft: false,
      conversationId: 'conv-123',
      streamTitle: '  Better title  ',
      liveTitle: 'New Conversation',
      sessions,
    })).toEqual({
      normalizedTitle: 'Better title',
      shouldPushLiveTitle: true,
      nextSessions: [
        { id: 'conv-123', title: 'Better title' },
        { id: 'conv-456', title: 'Other title' },
      ],
    });

    expect(resolveConversationStreamTitleSync({
      draft: false,
      conversationId: 'conv-123',
      streamTitle: 'Better title',
      liveTitle: 'Better title',
      sessions,
    })).toEqual({
      normalizedTitle: 'Better title',
      shouldPushLiveTitle: false,
      nextSessions: [
        { id: 'conv-123', title: 'Better title' },
        { id: 'conv-456', title: 'Other title' },
      ],
    });
  });

  it('preserves deferred resumes from the session snapshot when detail meta omits them', () => {
    const snapshot: SessionMeta = {
      id: 'conv-123',
      file: '/tmp/conv-123.jsonl',
      timestamp: '2026-03-29T00:00:00.000Z',
      cwd: '/tmp',
      cwdSlug: 'tmp',
      model: 'gpt-test',
      title: 'Snapshot title',
      messageCount: 12,
      deferredResumes: [{
        id: 'resume-1',
        sessionFile: '/tmp/conv-123.jsonl',
        prompt: 'continue later',
        dueAt: '2026-03-29T00:05:00.000Z',
        createdAt: '2026-03-29T00:00:00.000Z',
        attempts: 0,
        status: 'scheduled',
      }],
    };

    const detailMeta: SessionMeta = {
      ...snapshot,
      title: 'Detail title',
      deferredResumes: undefined,
    };

    const merged = mergeConversationSessionMeta(detailMeta, snapshot);

    expect(merged?.deferredResumes).toEqual(snapshot.deferredResumes);
    expect(merged?.title).toBe('Detail title');
    expect(merged?.file).toBe(snapshot.file);
  });

  it('formats background run indicator labels', () => {
    expect(formatConversationBackgroundRunStatusLabel('running')).toBe('running');
    expect(formatConversationBackgroundRunStatusLabel(undefined)).toBe('active');
  });

  it('summarizes active background runs for the conversation shelf', () => {
    const lookups = {
      sessions: [{
        id: 'conv-123',
        file: '/tmp/conv-123.jsonl',
        timestamp: '2026-03-29T00:00:00.000Z',
        cwd: '/tmp',
        cwdSlug: 'tmp',
        model: 'gpt-test',
        title: 'Bloodhounds',
        messageCount: 12,
      } as SessionMeta],
    };

    expect(buildConversationBackgroundRunIndicatorText([
      createBackgroundRun(),
    ], lookups)).toBe('running · npm run deploy:check');

    expect(buildConversationBackgroundRunIndicatorText([
      createBackgroundRun({ runId: 'run-background-456' }),
      createBackgroundRun({
        runId: 'run-background-789',
        manifest: {
          version: 1,
          id: 'run-background-789',
          kind: 'background-run',
          resumePolicy: 'manual',
          createdAt: '2026-03-29T00:02:00.000Z',
          spec: {
            taskSlug: 'review-deploy',
            shellCommand: 'npm run review:deploy',
          },
          source: {
            type: 'tool',
            id: 'conv-123',
          },
        },
      }),
    ], lookups)).toBe('2 active · latest npm run deploy:check');
  });

  it('truncates oversized queued prompt previews by line count', () => {
    expect(truncateConversationShelfText('1\n2\n3\n4', { maxLines: 3, maxChars: 100 })).toBe('1\n2\n3…');
  });

  it('truncates oversized queued prompt previews by character count', () => {
    expect(truncateConversationShelfText('abcdefghijklmnopqrstuvwxyz', { maxLines: 10, maxChars: 8 })).toBe('abcdefgh…');
  });

  it('renders image-only queued prompts with an explicit placeholder', () => {
    expect(formatQueuedPromptShelfText('', 1)).toBe('(image only)');
  });

  it('renders empty queued prompts distinctly when no images are attached', () => {
    expect(formatQueuedPromptShelfText('', 0)).toBe('(empty queued prompt)');
  });

  it('summarizes queued image attachments', () => {
    expect(formatQueuedPromptImageSummary(0)).toBeNull();
    expect(formatQueuedPromptImageSummary(1)).toBe('1 image attached');
    expect(formatQueuedPromptImageSummary(2)).toBe('2 images attached');
  });
});

describe('conversation git summary presentation', () => {
  it('returns a plain summary when the tree is clean or only has file counts', () => {
    expect(resolveConversationGitSummaryPresentation(null)).toEqual({ kind: 'none' });
    expect(resolveConversationGitSummaryPresentation({
      changeCount: 3,
      linesAdded: 0,
      linesDeleted: 0,
      changes: [],
    })).toEqual({ kind: 'summary', text: '3 files' });
  });

  it('returns split diff labels for added and deleted lines', () => {
    expect(resolveConversationGitSummaryPresentation({
      changeCount: 2,
      linesAdded: 1234,
      linesDeleted: 56,
      changes: [],
    })).toEqual({
      kind: 'diff',
      added: '+1,234',
      deleted: '-56',
    });
  });
});

describe('conversation composer shell state', () => {
  it('uses a subtle pulsing yellow glow when auto mode is enabled', () => {
    expect(resolveConversationComposerShellStateClassName({
      dragOver: false,
      hasInteractiveOverlay: false,
      autoModeEnabled: true,
    })).toBe('border-warning/30 ring-1 ring-warning/15 ui-input-shell-auto-mode');
  });

  it('prefers the interactive overlay accent state over the auto mode glow', () => {
    expect(resolveConversationComposerShellStateClassName({
      dragOver: false,
      hasInteractiveOverlay: true,
      autoModeEnabled: true,
    })).toBe('border-accent/40 ring-1 ring-accent/15');
  });

  it('prefers the drag-over state over the auto mode glow', () => {
    expect(resolveConversationComposerShellStateClassName({
      dragOver: true,
      hasInteractiveOverlay: false,
      autoModeEnabled: true,
    })).toBe('border-accent/50 ring-2 ring-accent/20 bg-accent/5');
  });
});

describe('ConversationPage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders without reading tree state before initialization', () => {
    expect(() => renderToString(
      <MemoryRouter initialEntries={['/conversations/test-session']}>
        <Routes>
          <Route path="/conversations/:id" element={<ConversationPage />} />
        </Routes>
      </MemoryRouter>,
    )).not.toThrow();
  });

  it('renders safely before the route param is available', () => {
    expect(() => renderToString(
      <MemoryRouter>
        <ConversationPage />
      </MemoryRouter>,
    )).not.toThrow();
  });

  it('shows the auto mode toggle on the new conversation page and moves workspace selection into the empty state', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/new']}>
        <ConversationPage draft />
      </MemoryRouter>,
    );

    expect(html).not.toContain('aria-label="Conversation context"');
    expect(html).not.toContain('Show right sidebar');
    expect(html).toContain('Saved workspace');
    expect(html).toContain('Use saved default workspace');
    expect(html).toContain('Browse…');
    expect(html).not.toContain('Start typing to create a conversation.');
    expect(html).not.toContain('Edit path');
    expect(html).not.toContain('set working directory');
    expect(html).not.toContain('Choose the initial working directory for this draft conversation');
    expect(html).toContain('Turn on conversation auto mode');
    expect(html).not.toContain('>draft<');
    expect(html).not.toContain('right rail');
  });

  it('renders the composer context row below the input shell', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/new']}>
        <ConversationPage draft />
      </MemoryRouter>,
    );

    const tree = parseFragment(html) as ParsedNode;
    const inputShell = findFirstNodeByClass(tree, 'ui-input-shell');
    const composerMeta = findFirstNodeByClass(tree, 'conversation-composer-meta');

    expect(inputShell).toBeTruthy();
    expect(composerMeta).toBeTruthy();
    expect(hasAncestorWithClass(composerMeta, 'ui-input-shell')).toBe(false);
    expect(composerMeta?.parentNode).toBe(inputShell?.parentNode);

    const siblings = inputShell?.parentNode?.childNodes?.filter((node) => node.nodeName !== '#text') ?? [];
    expect(siblings.indexOf(inputShell as ParsedNode)).toBeLessThan(siblings.indexOf(composerMeta as ParsedNode));
  });

  it('keeps the saved conversation composer constrained to the main content column without the old header fork button', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/test-session']}>
        <Routes>
          <Route path="/conversations/:id" element={<ConversationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('mx-auto w-full max-w-6xl');
    expect(html).not.toContain('aria-label="Summarize and fork this conversation"');
    expect(html).not.toContain('summarize + fork');
    expect(html).not.toContain('Show right sidebar');
  });
});
