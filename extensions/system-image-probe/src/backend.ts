import type { ExtensionBackendContext } from '@personal-agent/extensions';
import { runAgentTask } from '@personal-agent/extensions/backend/agent';
import {
  getImageProbeAttachments,
  getImageProbeAttachmentsById,
  type StoredImageProbeAttachment,
} from '@personal-agent/extensions/backend/images';

interface ProbeImageInput {
  imageIds?: unknown;
  question?: unknown;
}

interface ProbeFailureDetails {
  imageIds: string[];
  availableImageIds: string[];
  imagePaths: string[];
  model?: string;
  provider?: string;
}

function readImageIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Probe image requires at least one image ID.');
  if (value.length > 8) throw new Error('Probe image supports at most 8 image IDs.');
  const seen = new Set<string>();
  return value.map((item) => {
    if (typeof item !== 'string' || !/^img_[a-f0-9]{12}$/.test(item)) throw new Error(`Invalid image ID: ${String(item)}`);
    if (seen.has(item)) throw new Error(`Duplicate image ID: ${item}`);
    seen.add(item);
    return item;
  });
}

function readQuestion(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Probe image question is required.');
  if (value.length > 8000) throw new Error('Probe image question is too long.');
  return value.trim();
}

function classifyVisionProbeFailure(error: unknown, modelRef: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (/(402|insufficient|payment required|credits|billing)/.test(normalized)) {
    return `The configured vision model could not analyze the image because the provider reported a billing or credit problem. Check the provider account for ${modelRef}. Error: ${message}`;
  }
  if (/(does not support|not support|multimodal|image input|image_url|unsupported|does not accept images)/.test(normalized)) {
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

function buildProbePrompt(attachments: StoredImageProbeAttachment[], question: string): string {
  return [
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
    `Question: ${question}`,
  ].join('\n');
}

function resultDetails(
  attachments: StoredImageProbeAttachment[],
  available: StoredImageProbeAttachment[],
  model?: string,
  provider?: string,
): ProbeFailureDetails {
  return {
    imageIds: attachments.map((image) => image.id),
    availableImageIds: available.map((image) => image.id),
    imagePaths: attachments.map((image) => image.path),
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
  };
}

export async function probeImage(input: ProbeImageInput, ctx: ExtensionBackendContext) {
  const preferredVisionModel = ctx.toolContext?.preferredVisionModel?.trim();
  if (!preferredVisionModel) throw new Error('Probe image requires a configured preferred vision model.');
  const sessionId = ctx.toolContext?.sessionId ?? ctx.toolContext?.conversationId;
  if (!sessionId) throw new Error('Probe image requires an active conversation.');

  const imageIds = readImageIds(input.imageIds);
  const question = readQuestion(input.question);
  const availableAttachments = getImageProbeAttachments(sessionId) as StoredImageProbeAttachment[];
  const attachments = getImageProbeAttachmentsById(sessionId, imageIds) as StoredImageProbeAttachment[];
  if (attachments.length === 0) throw new Error('None of the requested image IDs are available to probe for this conversation.');
  if (attachments.length !== imageIds.length) {
    const foundIds = new Set(attachments.map((attachment) => attachment.id));
    const missing = imageIds.filter((id) => !foundIds.has(id));
    throw new Error(`Unknown image ID${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  }

  try {
    const result = await runAgentTask(
      {
        cwd: ctx.toolContext?.cwd,
        modelRef: preferredVisionModel,
        prompt: buildProbePrompt(attachments, question),
        images: attachments.map((image) => ({ type: 'image' as const, data: image.data, mimeType: image.mimeType })),
        tools: 'none',
      },
      ctx,
    );
    const text = result.text.trim() || '(vision subagent returned no text)';
    return {
      text,
      content: [{ type: 'text' as const, text }],
      details: resultDetails(attachments, availableAttachments, result.model, result.provider),
    };
  } catch (error) {
    const text = classifyVisionProbeFailure(error, preferredVisionModel);
    return {
      text,
      content: [{ type: 'text' as const, text }],
      details: resultDetails(attachments, availableAttachments),
      isError: true,
    };
  }
}
