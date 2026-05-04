import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getPiAgentRuntimeDir } from '@personal-agent/core';

import type { PromptImageAttachment } from '../conversations/liveSessionQueue.js';

export interface StoredImageProbeAttachment extends PromptImageAttachment {
  id: string;
  path: string;
  sizeBytes: number;
}

interface PersistedImageProbeAttachment {
  id: string;
  path: string;
  mimeType: string;
  name?: string;
  sizeBytes: number;
}

interface PersistedImageProbeAttachmentDocument {
  version: 1;
  attachments: PersistedImageProbeAttachment[];
}

export const MAX_IMAGE_PROBE_ATTACHMENTS_PER_PROMPT = 8;
export const MAX_IMAGE_PROBE_IMAGE_BYTES = 8 * 1024 * 1024;

const attachmentsBySession = new Map<string, Map<string, StoredImageProbeAttachment>>();

function resolveImageProbeSessionDir(sessionId: string): string {
  return join(getPiAgentRuntimeDir(), 'image-probes', safeFileName(sessionId, 'session'));
}

function resolveImageProbeMetadataPath(sessionId: string): string {
  return join(resolveImageProbeSessionDir(sessionId), 'metadata.json');
}

function safeFileName(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function fileExtensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'image/bmp') return '.bmp';
  return '.png';
}

function detectImageMimeType(buffer: Buffer): string | null {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  const header = buffer.subarray(0, 12).toString('ascii');
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif';
  }
  if (buffer.length >= 12 && header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.length >= 2 && header.startsWith('BM')) {
    return 'image/bmp';
  }
  return null;
}

function imageIdForData(data: string): { id: string; buffer: Buffer } {
  const buffer = Buffer.from(data, 'base64');
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  return { id: `img_${hash}`, buffer };
}

function normalizePersistedAttachment(value: unknown): PersistedImageProbeAttachment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<PersistedImageProbeAttachment>;
  if (typeof candidate.id !== 'string' || !/^img_[a-f0-9]{12}$/.test(candidate.id)) {
    return null;
  }
  if (typeof candidate.path !== 'string' || !candidate.path.trim()) {
    return null;
  }
  if (typeof candidate.mimeType !== 'string' || !candidate.mimeType.toLowerCase().startsWith('image/')) {
    return null;
  }
  if (!Number.isSafeInteger(candidate.sizeBytes) || candidate.sizeBytes < 0 || candidate.sizeBytes > MAX_IMAGE_PROBE_IMAGE_BYTES) {
    return null;
  }
  return {
    id: candidate.id,
    path: candidate.path,
    mimeType: candidate.mimeType,
    ...(typeof candidate.name === 'string' && candidate.name.trim() ? { name: candidate.name.trim() } : {}),
    sizeBytes: candidate.sizeBytes,
  };
}

function readPersistedImageProbeAttachments(sessionId: string): Map<string, StoredImageProbeAttachment> {
  const metadataPath = resolveImageProbeMetadataPath(sessionId);
  if (!existsSync(metadataPath)) {
    return new Map();
  }

  try {
    const parsed = JSON.parse(readFileSync(metadataPath, 'utf-8')) as Partial<PersistedImageProbeAttachmentDocument>;
    const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
    const next = new Map<string, StoredImageProbeAttachment>();
    for (const attachment of attachments) {
      const normalized = normalizePersistedAttachment(attachment);
      if (!normalized || !existsSync(normalized.path)) {
        continue;
      }
      const buffer = readFileSync(normalized.path);
      const detectedMimeType = detectImageMimeType(buffer);
      if (!detectedMimeType) {
        continue;
      }
      const data = buffer.toString('base64');
      next.set(normalized.id, { type: 'image', data, ...normalized, mimeType: detectedMimeType });
    }
    return next;
  } catch {
    return new Map();
  }
}

function writePersistedImageProbeAttachments(sessionId: string, attachments: Map<string, StoredImageProbeAttachment>): void {
  const metadataPath = resolveImageProbeMetadataPath(sessionId);
  const document: PersistedImageProbeAttachmentDocument = {
    version: 1,
    attachments: Array.from(attachments.values()).map((attachment) => ({
      id: attachment.id,
      path: attachment.path,
      mimeType: attachment.mimeType,
      ...(attachment.name ? { name: attachment.name } : {}),
      sizeBytes: attachment.sizeBytes,
    })),
  };
  mkdirSync(resolveImageProbeSessionDir(sessionId), { recursive: true });
  writeFileSync(metadataPath, `${JSON.stringify(document, null, 2)}\n`);
}

function getSessionAttachments(sessionId: string): Map<string, StoredImageProbeAttachment> {
  const cached = attachmentsBySession.get(sessionId);
  if (cached) {
    return cached;
  }
  const persisted = readPersistedImageProbeAttachments(sessionId);
  attachmentsBySession.set(sessionId, persisted);
  return persisted;
}

export function rememberImageProbeAttachments(sessionId: string, images: PromptImageAttachment[]): StoredImageProbeAttachment[] {
  if (images.length > MAX_IMAGE_PROBE_ATTACHMENTS_PER_PROMPT) {
    throw new Error(`Image probing supports at most ${MAX_IMAGE_PROBE_ATTACHMENTS_PER_PROMPT} images per prompt.`);
  }

  const dir = resolveImageProbeSessionDir(sessionId);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sessionAttachments = getSessionAttachments(sessionId);
  const stored = images.map((image, index) => {
    const { id, buffer } = imageIdForData(image.data);
    const detectedMimeType = detectImageMimeType(buffer);
    if (!detectedMimeType) {
      throw new Error(`Image ${image.name?.trim() || index + 1} is not a supported image file.`);
    }
    if (buffer.byteLength > MAX_IMAGE_PROBE_IMAGE_BYTES) {
      throw new Error(
        `Image ${image.name?.trim() || index + 1} is too large for image probing (${buffer.byteLength} bytes; max ${MAX_IMAGE_PROBE_IMAGE_BYTES}).`,
      );
    }
    const fallbackName = `image-${index + 1}${fileExtensionForMimeType(detectedMimeType)}`;
    const fileName = `${stamp}-${index + 1}-${id}-${safeFileName(image.name, fallbackName)}`;
    const path = join(dir, fileName);
    writeFileSync(path, buffer);
    const attachment = { ...image, id, path, mimeType: detectedMimeType, sizeBytes: buffer.byteLength };
    sessionAttachments.set(id, attachment);
    return attachment;
  });
  attachmentsBySession.set(sessionId, sessionAttachments);
  writePersistedImageProbeAttachments(sessionId, sessionAttachments);
  return stored;
}

export function getImageProbeAttachments(sessionId: string): StoredImageProbeAttachment[] {
  return Array.from(getSessionAttachments(sessionId).values());
}

export function getImageProbeAttachmentsById(sessionId: string, imageIds: string[]): StoredImageProbeAttachment[] {
  const sessionAttachments = getSessionAttachments(sessionId);
  return imageIds
    .map((id) => sessionAttachments.get(id))
    .filter((attachment): attachment is StoredImageProbeAttachment => Boolean(attachment));
}

export function clearImageProbeAttachmentCacheForTests(): void {
  attachmentsBySession.clear();
}
