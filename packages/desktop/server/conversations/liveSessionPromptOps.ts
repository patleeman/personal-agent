import type { AgentSession } from '@earendil-works/pi-coding-agent';

import { rememberImageProbeAttachments, type StoredImageProbeAttachment } from '../extensions/imageProbeAttachmentStore.js';
import { readSavedModelPreferences } from '../models/modelPreferences.js';
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

/** Ensure the last assistant message in agent state has usage data.
 *  pi-coding-agent's _checkCompaction() crashes via calculateContextTokens(undefined)
 *  when an assistant message with a valid stopReason lacks usage (e.g. imported sessions). */
function sealLastAssistantUsage(session: AgentSession): void {
  const msgs = (session as { messages?: Array<{ role: string; stopReason?: string; usage?: unknown }> }).messages;
  if (!msgs || msgs.length === 0) return;
  const last = msgs[msgs.length - 1];
  if (last?.role === 'assistant' && last.stopReason !== 'aborted' && last.stopReason !== 'error' && !last.usage) {
    (last as { usage: Record<string, unknown> }).usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  }
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

  // Guard: pi-coding-agent's _checkCompaction() crashes when the last
  // assistant message has stopReason but no usage. Pre-fill a zero usage
  // so calculateContextTokens(undefined) doesn't throw.
  sealLastAssistantUsage(session);

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

  try {
    await runPrompt(!shouldUseTextOnlyImageHandling);
  } catch (error) {
    if (!hasImages || !isLikelyUnsupportedImageInputError(error)) {
      throw error;
    }

    await runPrompt(false);
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
