import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { getPiAgentRuntimeDir } from '@personal-agent/core';

import type { PromptImageAttachment } from '../conversations/liveSessionQueue.js';

export interface StoredImageProbeAttachment extends PromptImageAttachment {
  id: string;
  path: string;
  sizeBytes: number;
}

const attachmentsBySession = new Map<string, Map<string, StoredImageProbeAttachment>>();

function safeFileName(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function extensionForImage(image: PromptImageAttachment): string {
  const fromName = image.name ? extname(image.name).trim() : '';
  if (fromName) return fromName;
  if (image.mimeType === 'image/jpeg') return '.jpg';
  if (image.mimeType === 'image/webp') return '.webp';
  if (image.mimeType === 'image/gif') return '.gif';
  return '.png';
}

function imageIdForData(data: string): { id: string; buffer: Buffer } {
  const buffer = Buffer.from(data, 'base64');
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  return { id: `img_${hash}`, buffer };
}

export function rememberImageProbeAttachments(sessionId: string, images: PromptImageAttachment[]): StoredImageProbeAttachment[] {
  const dir = join(getPiAgentRuntimeDir(), 'image-probes', safeFileName(sessionId, 'session'));
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sessionAttachments = attachmentsBySession.get(sessionId) ?? new Map<string, StoredImageProbeAttachment>();
  const stored = images.map((image, index) => {
    const { id, buffer } = imageIdForData(image.data);
    const fallbackName = `image-${index + 1}${extensionForImage(image)}`;
    const fileName = `${stamp}-${index + 1}-${id}-${safeFileName(image.name, fallbackName)}`;
    const path = join(dir, fileName);
    writeFileSync(path, buffer);
    const attachment = { ...image, id, path, sizeBytes: buffer.byteLength };
    sessionAttachments.set(id, attachment);
    return attachment;
  });
  attachmentsBySession.set(sessionId, sessionAttachments);
  return stored;
}

export function getImageProbeAttachments(sessionId: string): StoredImageProbeAttachment[] {
  return Array.from(attachmentsBySession.get(sessionId)?.values() ?? []);
}

export function getImageProbeAttachmentsById(sessionId: string, imageIds: string[]): StoredImageProbeAttachment[] {
  const sessionAttachments = attachmentsBySession.get(sessionId);
  if (!sessionAttachments) {
    return [];
  }
  return imageIds
    .map((id) => sessionAttachments.get(id))
    .filter((attachment): attachment is StoredImageProbeAttachment => Boolean(attachment));
}
