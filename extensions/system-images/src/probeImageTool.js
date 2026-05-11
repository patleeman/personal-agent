import { join } from 'node:path';
import { AuthStorage, createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { getImageProbeAttachments, getImageProbeAttachmentsById, getPiAgentRuntimeDir } from '@personal-agent/extensions/backend';
import { Type } from '@sinclair/typebox';
const ImageProbeParams = Type.Object({
  imageIds: Type.Array(Type.String({ pattern: '^img_[a-f0-9]{12}$' }), {
    minItems: 1,
    maxItems: 8,
    description: 'One or more attached image IDs to inspect, for example ["img_a1b2c3d4e5f6"].',
  }),
  question: Type.String({
    minLength: 1,
    maxLength: 8000,
    description: 'The specific question to ask the vision subagent about the selected image attachments.',
  }),
});
function modelAcceptsImages(model) {
  const input = model?.input;
  return Array.isArray(input) && input.includes('image');
}
function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && part.type === 'text') {
        return typeof part.text === 'string' ? part.text : '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}
function collectAssistantTextsFromSession(session) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) => extractTextContent(message.content).trim())
    .filter(Boolean);
}
function getAssistantErrorMessage(session) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    const errorMessage = message.errorMessage;
    if (typeof errorMessage === 'string' && errorMessage.trim()) {
      return errorMessage.trim();
    }
  }
  return null;
}
function resolvePreferredVisionModel(models, modelRef) {
  const normalized = modelRef.trim();
  if (!normalized) {
    return null;
  }
  const slashIndex = normalized.indexOf('/');
  if (slashIndex > 0 && slashIndex < normalized.length - 1) {
    const provider = normalized.slice(0, slashIndex);
    const id = normalized.slice(slashIndex + 1);
    return models.find((model) => model.provider === provider && model.id === id) ?? null;
  }
  return models.find((model) => model.id === normalized) ?? null;
}
function classifyVisionProbeFailure(error, modelRef) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (/(402|insufficient|payment required|credits|billing)/.test(normalized)) {
    return `The configured vision model could not analyze the image because the provider reported a billing or credit problem. Check the provider account for ${modelRef}. Error: ${message}`;
  }
  if (/(does not support|not support|multimodal|image input|image_url|unsupported)/.test(normalized)) {
    return `The configured vision model does not appear to support this image request. Pick a different image-capable vision model in Settings. Model: ${modelRef}. Error: ${message}`;
  }
  if (/(too large|payload|413|content_too_large|request_too_large|exceeds|size limit)/.test(normalized)) {
    return `The selected image is too large for the configured vision model. Try a smaller screenshot or compressed image. Model: ${modelRef}. Error: ${message}`;
  }
  if (/(invalid image|unsupported format|corrupt|decode|mime)/.test(normalized)) {
    return `The vision model rejected the image format or could not decode the image. Try a PNG or JPEG screenshot. Error: ${message}`;
  }
  return `The configured vision model failed while analyzing the image. Model: ${modelRef}. Error: ${message}`;
}
export function createImageProbeAgentExtension(options) {
  return (pi) => {
    pi.registerTool({
      name: 'probe_image',
      label: 'Probe Image',
      description: 'Ask the configured vision subagent about selected image attachments when the current model cannot see images.',
      promptSnippet:
        'Use probe_image with explicit imageIds to inspect attached images when this model cannot receive image input directly.',
      promptGuidelines: [
        'If the user attached images and the prompt says this model cannot see them directly, call probe_image with the listed image IDs before answering image-specific questions.',
        'Pass one or more imageIds in a single call. For comparisons, pass all images that should be compared and ask the comparison question directly.',
        'Ask focused follow-up questions with probe_image when you need more visual detail; each call can inspect the same image IDs from a different angle.',
        'Do not claim to have seen an image unless probe_image returned enough detail or the image was already described in conversation context.',
      ],
      parameters: ImageProbeParams,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const availableAttachments = getImageProbeAttachments(ctx.sessionManager.getSessionId());
        const attachments = getImageProbeAttachmentsById(ctx.sessionManager.getSessionId(), params.imageIds);
        if (attachments.length === 0) {
          throw new Error('None of the requested image IDs are available to probe for this conversation.');
        }
        if (attachments.length !== params.imageIds.length) {
          const foundIds = new Set(attachments.map((attachment) => attachment.id));
          const missing = params.imageIds.filter((id) => !foundIds.has(id));
          throw new Error(`Unknown image ID${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
        }
        const preferredVisionModel = options.getPreferredVisionModel();
        const model = resolvePreferredVisionModel(ctx.modelRegistry.getAvailable(), preferredVisionModel);
        if (!model || !modelAcceptsImages(model)) {
          throw new Error(`Configured vision model is not available or does not accept images: ${preferredVisionModel || '(unset)'}`);
        }
        const assistantTexts = [];
        let session = null;
        let unsubscribe = null;
        try {
          if (signal?.aborted) throw new Error('Image probe was aborted.');
          session = (
            await createAgentSession({
              cwd: ctx.cwd,
              model: model,
              authStorage: AuthStorage.create(join(getPiAgentRuntimeDir(), 'auth.json')),
              modelRegistry: ctx.modelRegistry,
              sessionManager: SessionManager.inMemory(ctx.cwd),
              noTools: 'all',
            })
          ).session;
          unsubscribe = session.subscribe((event) => {
            if (event.type === 'message_end' && event.message.role === 'assistant') {
              const text = extractTextContent(event.message.content).trim();
              if (text) assistantTexts.push(text);
            }
          });
          const prompt = [
            'You are a vision probe for a text-only agent.',
            '',
            'The calling agent cannot see the attached images. Act as its eyes.',
            'Fully describe the relevant visual parts of the image, then answer the question directly.',
            'Include enough visual detail and evidence for the calling agent to reason from your answer without seeing the image.',
            '',
            'Guidelines:',
            '- Start with the direct answer.',
            '- Then describe the visual evidence that supports it.',
            '- Quote visible text exactly when relevant.',
            '- Mention uncertainty, occlusion, low resolution, or ambiguity.',
            '- Include nearby or contextual visual details likely relevant to the caller intent.',
            '- Do not give one-word answers unless the question explicitly asks for one.',
            '- Do not invent hidden state, off-screen content, or user intent beyond what is visible.',
            '- When multiple images are provided, refer to each image by ID.',
            '',
            'Selected images:',
            ...attachments.map((image) => `- ${image.id}: ${image.name?.trim() || 'unnamed image'} (${image.mimeType})`),
            '',
            `Question: ${params.question}`,
          ].join('\n');
          await session.prompt(prompt, {
            images: attachments.map((image) => ({ type: 'image', data: image.data, mimeType: image.mimeType })),
          });
          const assistantError = getAssistantErrorMessage(session);
          if (assistantError) {
            throw new Error(assistantError);
          }
          if (assistantTexts.length === 0) {
            assistantTexts.push(...collectAssistantTextsFromSession(session));
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: classifyVisionProbeFailure(error, preferredVisionModel) }],
            details: {
              imageIds: attachments.map((image) => image.id),
              availableImageIds: availableAttachments.map((image) => image.id),
              imagePaths: attachments.map((image) => image.path),
              model: model.id,
              provider: model.provider,
            },
            isError: true,
          };
        } finally {
          unsubscribe?.();
          session?.dispose();
        }
        const text = assistantTexts.at(-1)?.trim() || '(vision subagent returned no text)';
        return {
          content: [{ type: 'text', text }],
          details: {
            imageIds: attachments.map((image) => image.id),
            availableImageIds: availableAttachments.map((image) => image.id),
            imagePaths: attachments.map((image) => image.path),
            model: model.id,
            provider: model.provider,
          },
        };
      },
    });
  };
}
