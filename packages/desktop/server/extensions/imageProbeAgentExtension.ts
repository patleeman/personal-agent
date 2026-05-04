import { createAgentSession, type ExtensionAPI, SessionManager } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

import { getImageProbeAttachments } from './imageProbeAttachmentStore.js';

const ImageProbeParams = Type.Object({
  question: Type.String({
    description: 'The specific question to ask the vision subagent about the latest image attachments.',
  }),
});

function modelAcceptsImages(model: unknown): boolean {
  const input = (model as { input?: unknown } | undefined)?.input;
  return Array.isArray(input) && input.includes('image');
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
        return typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function findVisionModel(models: unknown[]): unknown | null {
  return models.find((model) => modelAcceptsImages(model)) ?? null;
}

export function createImageProbeAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'probe_image',
      label: 'Probe Image',
      description: 'Ask a vision-capable subagent about the latest image attachments when the current model cannot see images.',
      promptSnippet: 'Use probe_image to inspect latest image attachments when this model cannot receive image input directly.',
      promptGuidelines: [
        'If the user attached images and the prompt says this model cannot see them directly, call probe_image before answering image-specific questions.',
        'Ask focused follow-up questions with probe_image when you need more visual detail; each call can inspect the same latest attachments from a different angle.',
        'Do not claim to have seen an image unless probe_image returned enough detail or the image was already described in conversation context.',
      ],
      parameters: ImageProbeParams,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const attachments = getImageProbeAttachments(ctx.sessionManager.getSessionId());
        if (attachments.length === 0) {
          throw new Error('No image attachments are available to probe for this conversation.');
        }

        const model = findVisionModel(ctx.modelRegistry.getAvailable());
        if (!model) {
          throw new Error('No configured image-capable model is available for image probing.');
        }

        const { session } = await createAgentSession({
          cwd: ctx.cwd,
          model: model as never,
          modelRegistry: ctx.modelRegistry,
          sessionManager: SessionManager.inMemory(ctx.cwd),
          noTools: 'all',
        });

        const assistantTexts: string[] = [];
        const unsubscribe = session.subscribe((event) => {
          if (event.type === 'message_end' && event.message.role === 'assistant') {
            const text = extractTextContent(event.message.content).trim();
            if (text) assistantTexts.push(text);
          }
        });

        try {
          if (signal?.aborted) throw new Error('Image probe was aborted.');
          const prompt = [
            'You are a focused vision subagent. Answer the user question using only the attached image(s).',
            'Be precise. If the image does not show enough evidence, say so.',
            '',
            `Question: ${params.question}`,
          ].join('\n');
          await session.prompt(prompt, {
            images: attachments.map((image) => ({ type: 'image' as const, data: image.data, mimeType: image.mimeType })),
          });
        } finally {
          unsubscribe();
          session.dispose();
        }

        const text = assistantTexts.at(-1)?.trim() || '(vision subagent returned no text)';
        return {
          content: [{ type: 'text' as const, text }],
          details: {
            imageCount: attachments.length,
            imagePaths: attachments.map((image) => image.path),
            model: (model as { provider?: string; id?: string }).id,
            provider: (model as { provider?: string; id?: string }).provider,
          },
        };
      },
    });
  };
}
