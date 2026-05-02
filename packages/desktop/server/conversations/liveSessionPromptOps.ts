import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { getAssistantErrorDisplayMessage } from './sessions.js';
import type { PromptImageAttachment } from './liveSessionQueue.js';

export interface LiveSessionPromptHost {
  sessionId: string;
  session: AgentSession;
}

export type LiveSessionPromptBehavior = 'steer' | 'followUp' | undefined;

export function isLikelyUnsupportedImageInputError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  const mentionsImageInput = normalized.includes('image')
    || normalized.includes('vision')
    || normalized.includes('multimodal');

  const indicatesUnsupported = normalized.includes('not support')
    || normalized.includes('unsupported')
    || normalized.includes('not enabled')
    || normalized.includes('text-only')
    || normalized.includes('text only')
    || normalized.includes('invalid image')
    || normalized.includes('image input');

  return mentionsImageInput && indicatesUnsupported;
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

  if (behavior === undefined) {
    callbacks.repairLiveSessionTranscriptTail(entry.sessionId);
  }

  const runPrompt = async (allowImages: boolean): Promise<void> => {
    if (behavior === 'steer') {
      await (allowImages && hasImages ? session.steer(text, images) : session.steer(text));
      callbacks.broadcastQueueState(entry, true);
      return;
    }

    if (behavior === 'followUp') {
      await (allowImages && hasImages ? session.followUp(text, images) : session.followUp(text));
      callbacks.broadcastQueueState(entry, true);
      return;
    }

    await (allowImages && hasImages ? session.prompt(text, { images }) : session.prompt(text));
  };

  try {
    await runPrompt(true);
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
    runPromptOnLiveEntry: (entry: TEntry, text: string, behavior: LiveSessionPromptBehavior, images?: PromptImageAttachment[]) => Promise<void>;
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
