import type { AgentSession } from '@mariozechner/pi-coding-agent';

import { rememberImageProbeAttachments, type StoredImageProbeAttachment } from '../extensions/imageProbeAttachmentStore.js';
import { readSavedModelPreferences } from '../models/modelPreferences.js';
import { logWarn } from '../shared/logging.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE } from '../ui/settingsPersistence.js';
import type { PromptImageAttachment } from './liveSessionQueue.js';
import { getAssistantErrorDisplayMessage } from './sessions.js';

export interface LiveSessionPromptHost {
  sessionId: string;
  session: AgentSession;
}

export type LiveSessionPromptBehavior = 'steer' | 'followUp' | undefined;

export function isLikelyUnsupportedImageInputError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  const mentionsImageInput = normalized.includes('image') || normalized.includes('vision') || normalized.includes('multimodal');

  const indicatesUnsupported =
    normalized.includes('not support') ||
    normalized.includes('unsupported') ||
    normalized.includes('not enabled') ||
    normalized.includes('text-only') ||
    normalized.includes('text only') ||
    normalized.includes('invalid image') ||
    normalized.includes('image input');

  return mentionsImageInput && indicatesUnsupported;
}

function liveSessionModelAcceptsImages(model: unknown): boolean {
  const input = (model as { input?: unknown } | undefined)?.input;
  return Array.isArray(input) && input.includes('image');
}

function getPreferredVisionModel(): string {
  return readSavedModelPreferences(DEFAULT_RUNTIME_SETTINGS_FILE).currentVisionModel;
}

function appendImageProbeNotice(text: string, images: StoredImageProbeAttachment[], preferredVisionModel: string): string {
  const names = images.map((image) => `- ${image.id}: ${image.name?.trim() || 'unnamed image'} (${image.mimeType})`).join('\n');
  const instruction = preferredVisionModel
    ? 'Use the probe_image tool with explicit imageIds to inspect these image(s) before answering image-specific questions.'
    : 'No preferred vision model is configured, so image probing is unavailable. Ask the user to configure a preferred vision model before analyzing these images.';
  const notice = [
    '[Image attachments received]',
    `The user attached ${images.length} image${images.length === 1 ? '' : 's'}, but the current model cannot receive image input directly.`,
    instruction,
    names ? `Attached image IDs:\n${names}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return `${text.trim()}\n\n${notice}`.trim();
}

export async function runPromptOnLiveEntry<TEntry extends LiveSessionPromptHost>(
  entry: TEntry,
  text: string,
  behavior: LiveSessionPromptBehavior,
  images: PromptImageAttachment[] | undefined,
  callbacks: {
    repairLiveSessionTranscriptTail: (sessionId: string) => unknown;
    broadcastQueueState: (entry: TEntry, force?: boolean) => void;
  },
): Promise<void> {
  const { session } = entry;
  const hasImages = Boolean(images && images.length > 0);
  const shouldUseTextOnlyImageHandling = hasImages && !liveSessionModelAcceptsImages(session.model);
  const preferredVisionModel = shouldUseTextOnlyImageHandling ? getPreferredVisionModel() : '';
  const storedImages = shouldUseTextOnlyImageHandling && images ? rememberImageProbeAttachments(entry.sessionId, images) : [];
  const promptText = shouldUseTextOnlyImageHandling ? appendImageProbeNotice(text, storedImages, preferredVisionModel) : text;

  if (behavior === undefined) {
    callbacks.repairLiveSessionTranscriptTail(entry.sessionId);
  }

  const runPrompt = async (allowImages: boolean): Promise<void> => {
    if (behavior === 'steer') {
      await (allowImages && hasImages ? session.steer(promptText, images) : session.steer(promptText));
      callbacks.broadcastQueueState(entry, true);
      return;
    }

    if (behavior === 'followUp') {
      await (allowImages && hasImages ? session.followUp(promptText, images) : session.followUp(promptText));
      callbacks.broadcastQueueState(entry, true);
      return;
    }

    await (allowImages && hasImages ? session.prompt(promptText, { images }) : session.prompt(promptText));
  };

  // Wrap each prompt call with a stuck-session watchdog. The pi-coding-agent
  // auto-retry path can leave _retryPromise dangling if agent.continue() throws
  // before starting a new run (e.g. "Agent is already processing"). In that
  // case session.prompt() never resolves and the conversation appears frozen.
  // The watchdog detects inactivity past a generous deadline and aborts the
  // session, which calls abortRetry() and resolves the stuck promise.
  const withStuckSessionWatchdog = async (fn: () => Promise<void>): Promise<void> => {
    // Max time we'll wait for a single prompt + retry cycle: 10 minutes.
    const STUCK_SESSION_TIMEOUT_MS = 10 * 60 * 1000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        logWarn('stuck session watchdog fired — aborting to recover', { sessionId: entry.sessionId });
        void session.abort().catch(() => {});
        reject(new Error('Conversation response timed out and was aborted. Please try again.'));
      }, STUCK_SESSION_TIMEOUT_MS);
    });
    try {
      await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  };

  try {
    await withStuckSessionWatchdog(() => runPrompt(!shouldUseTextOnlyImageHandling));
  } catch (error) {
    if (!hasImages || !isLikelyUnsupportedImageInputError(error)) {
      throw error;
    }

    await withStuckSessionWatchdog(() => runPrompt(false));
  }
}

export async function submitPromptOnLiveEntry<TEntry extends LiveSessionPromptHost>(
  entry: TEntry,
  text: string,
  behavior: LiveSessionPromptBehavior,
  images: PromptImageAttachment[] | undefined,
  callbacks: {
    runPromptOnLiveEntry: (
      entry: TEntry,
      text: string,
      behavior: LiveSessionPromptBehavior,
      images?: PromptImageAttachment[],
    ) => Promise<void>;
  },
): Promise<{ acceptedAs: 'started' | 'queued'; completion: Promise<void> }> {
  if (behavior === 'steer' || behavior === 'followUp') {
    await callbacks.runPromptOnLiveEntry(entry, text, behavior, images);
    return {
      acceptedAs: 'queued',
      completion: Promise.resolve(),
    };
  }

  let settled = false;
  let unsubscribe: (() => void) | null = null;
  const accepted = new Promise<void>((resolve, reject) => {
    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      unsubscribe?.();
      unsubscribe = null;
      handler();
    };

    unsubscribe = entry.session.subscribe((event) => {
      if (event.type === 'message_start' && event.message.role === 'user') {
        finish(resolve);
        return;
      }

      if (event.type === 'agent_start' || event.type === 'agent_end' || event.type === 'turn_end') {
        finish(resolve);
        return;
      }

      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const errorMessage = getAssistantErrorDisplayMessage(event.message);
        if (errorMessage) {
          finish(() => reject(new Error(errorMessage)));
        }
      }
    });
  });

  const completion = callbacks.runPromptOnLiveEntry(entry, text, behavior, images);
  void completion
    .finally(() => {
      if (!settled) {
        settled = true;
        unsubscribe?.();
        unsubscribe = null;
      }
    })
    .catch(() => {
      // The caller observes prompt-start failures through the race below, and
      // accepted prompts expose their eventual failure through the transcript.
      // Do not let the detached completion cleanup promise become an unhandled
      // rejection and take down the companion dev host.
    });

  await Promise.race([accepted, completion]);
  return {
    acceptedAs: 'started',
    completion,
  };
}
