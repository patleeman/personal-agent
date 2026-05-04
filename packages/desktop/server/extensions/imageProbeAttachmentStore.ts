import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { getPiAgentRuntimeDir } from '@personal-agent/core';

import type { PromptImageAttachment } from '../conversations/liveSessionQueue.js';

export interface StoredImageProbeAttachment extends PromptImageAttachment {
  path: string;
}

const attachmentsBySession = new Map<string, StoredImageProbeAttachment[]>();

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

export function rememberImageProbeAttachments(sessionId: string, images: PromptImageAttachment[]): StoredImageProbeAttachment[] {
  const dir = join(getPiAgentRuntimeDir(), 'image-probes', safeFileName(sessionId, 'session'));
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stored = images.map((image, index) => {
    const fallbackName = `image-${index + 1}${extensionForImage(image)}`;
    const fileName = `${stamp}-${index + 1}-${safeFileName(image.name, fallbackName)}`;
    const path = join(dir, fileName);
    writeFileSync(path, Buffer.from(image.data, 'base64'));
    return { ...image, path };
  });
  attachmentsBySession.set(sessionId, stored);
  return stored;
}

export function getImageProbeAttachments(sessionId: string): StoredImageProbeAttachment[] {
  return attachmentsBySession.get(sessionId) ?? [];
}
