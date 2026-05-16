import { AuthStorage, createAgentSession, type ExtensionAPI, SessionManager } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';

import {
  getImageProbeAttachments,
  getImageProbeAttachmentsById,
  type StoredImageProbeAttachment,
} from '../../../../packages/desktop/server/extensions/imageProbeAttachmentStore.js';

interface Options {
  getPreferredVisionModel(): string;
}

interface ExecuteContext {
  cwd?: string;
  sessionManager?: { getSessionId?: () => string };
  modelRegistry?: { getAvailable?: () => Array<{ provider: string; id: string; input?: string[] }> };
}

const schema = Type.Object({
  imageIds: Type.Array(Type.String(), { minItems: 1, maxItems: 8 }),
  question: Type.String({ minLength: 1, maxLength: 8000 }),
});

function parseModelRef(ref: string): { provider: string; id: string } {
  const [provider, ...rest] = ref.split('/');
  return { provider: provider ?? '', id: rest.join('/') };
}

function buildPrompt(attachments: StoredImageProbeAttachment[], question: string): string {
  return [
    'You are a vision probe for a text-only agent.',
    'The calling agent cannot see the attached images. Act as its eyes.',
    'Fully describe the relevant visual parts of the image, then answer the question directly.',
    '',
    'Selected images:',
    ...attachments.map((image) => `- ${image.id}: ${image.name?.trim() || 'unnamed image'} (${image.mimeType})`),
    '',
    `Question: ${question}`,
  ].join('\n');
}

function classify(error: unknown, modelRef: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/(402|insufficient|payment required|credits|billing)/i.test(message)) {
    return `The configured vision model could not analyze the image because the provider reported a billing or credit problem. Check the provider account for ${modelRef}. Error: ${message}`;
  }
  return `The configured vision model failed while analyzing the image. Model: ${modelRef}. Error: ${message}`;
}

export function createImageProbeAgentExtension(options: Options) {
  return (api: Pick<ExtensionAPI, 'registerTool'>) => {
    api.registerTool({
      name: 'probe_image',
      description: 'Ask a configured vision model about selected image attachments.',
      params: schema,
      execute: async (
        _toolId: string,
        input: { imageIds?: unknown; question?: unknown },
        _1?: unknown,
        _2?: unknown,
        context?: ExecuteContext,
      ) => {
        if (!Array.isArray(input.imageIds) || input.imageIds.length === 0) throw new Error('Probe image requires at least one image ID.');
        const imageIds = input.imageIds.map(String);
        const question = typeof input.question === 'string' ? input.question.trim() : '';
        if (!question) throw new Error('Probe image question is required.');

        const sessionId = context?.sessionManager?.getSessionId?.() ?? '';
        const available = getImageProbeAttachments(sessionId);
        const attachments = getImageProbeAttachmentsById(sessionId, imageIds);
        if (attachments.length === 0) throw new Error('None of the requested image IDs are available to probe for this conversation.');
        if (attachments.length !== imageIds.length) throw new Error('Unknown image ID');

        const modelRef = options.getPreferredVisionModel();
        const parsed = parseModelRef(modelRef);
        const model = context?.modelRegistry
          ?.getAvailable?.()
          .find((candidate) => candidate.provider === parsed.provider && candidate.id === parsed.id);
        if (!model || !model.input?.includes('image'))
          throw new Error('Configured vision model is not available or does not accept images');

        const sessionResult = await createAgentSession({
          cwd: context?.cwd,
          sessionManager: SessionManager.inMemory(context?.cwd ?? process.cwd()),
          authStorage: AuthStorage.create('auth.json'),
          model,
        } as never);
        const session = (
          sessionResult as {
            session: {
              subscribe: (handler: (event: { type: string; message?: { role?: string; content?: unknown } }) => void) => () => void;
              prompt: (
                prompt: string,
                options: { attachments: Array<{ path: string; mimeType?: string; name?: string }> },
              ) => Promise<unknown>;
              dispose?: () => void;
            };
          }
        ).session;
        let text = '';
        const unsubscribe = session.subscribe((event: { type: string; message?: { role?: string; content?: unknown } }) => {
          if (event.type !== 'message_end' || event.message?.role !== 'assistant' || !Array.isArray(event.message.content)) return;
          text = event.message.content
            .map((item) => (typeof item === 'object' && item && 'text' in item ? String((item as { text?: unknown }).text ?? '') : ''))
            .filter(Boolean)
            .join('\n');
        });
        try {
          await session.prompt(buildPrompt(attachments, question), {
            images: attachments.map((image) => ({ type: 'image' as const, data: image.data, mimeType: image.mimeType })),
          });
        } catch (error) {
          const failure = classify(error, modelRef);
          return {
            isError: true,
            content: [{ type: 'text' as const, text: failure }],
            details: { imageIds, availableImageIds: available.map((i) => i.id) },
          };
        } finally {
          unsubscribe?.();
          session.dispose?.();
        }
        const assistantError = (
          session as { messages?: Array<{ role?: string; stopReason?: string; errorMessage?: string }> }
        ).messages?.find((message) => message.role === 'assistant' && message.stopReason === 'error' && message.errorMessage);
        if (assistantError?.errorMessage) {
          const failure = classify(new Error(assistantError.errorMessage), modelRef);
          return {
            isError: true,
            content: [{ type: 'text' as const, text: failure }],
            details: { imageIds, model: model.id, provider: model.provider },
          };
        }
        return { content: [{ type: 'text' as const, text }], details: { imageIds, model: model.id, provider: model.provider } };
      },
    } as never);
  };
}
