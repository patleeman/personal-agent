import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearImageProbeAttachmentCacheForTests,
  getImageProbeAttachments,
  getImageProbeAttachmentsById,
  MAX_IMAGE_PROBE_ATTACHMENTS_PER_PROMPT,
  MAX_IMAGE_PROBE_IMAGE_BYTES,
  rememberImageProbeAttachments,
} from './imageProbeAttachmentStore.js';

const tempDirs: string[] = [];
const originalStateRoot = process.env.PERSONAL_AGENT_STATE_ROOT;
const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngData(label: string): string {
  return Buffer.concat([pngHeader, Buffer.from(label)]).toString('base64');
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-image-probe-store-'));
  tempDirs.push(dir);
  process.env.PERSONAL_AGENT_STATE_ROOT = dir;
});

afterEach(async () => {
  clearImageProbeAttachmentCacheForTests();
  if (originalStateRoot === undefined) {
    delete process.env.PERSONAL_AGENT_STATE_ROOT;
  } else {
    process.env.PERSONAL_AGENT_STATE_ROOT = originalStateRoot;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('image probe attachment store', () => {
  it('assigns stable content IDs and persists attachments for later lookup', () => {
    const data = pngData('image-bytes');
    const stored = rememberImageProbeAttachments('session-1', [{ type: 'image', data, mimeType: 'image/png', name: 'screen.png' }]);

    expect(stored[0]).toMatchObject({ id: expect.stringMatching(/^img_[a-f0-9]{12}$/), data, mimeType: 'image/png', name: 'screen.png' });
    expect(getImageProbeAttachmentsById('session-1', [stored[0]!.id])).toEqual(stored);
    expect(getImageProbeAttachments('session-1')).toEqual(stored);
  });

  it('can reload persisted metadata when the process-local cache is empty for a new session lookup', () => {
    const data = pngData('persistent-image');
    const stored = rememberImageProbeAttachments('session-persisted', [
      { type: 'image', data, mimeType: 'image/png', name: 'persisted.png' },
    ]);
    clearImageProbeAttachmentCacheForTests();

    // Different session id proves the lookup is not just returning every cached entry.
    expect(getImageProbeAttachments('another-session')).toEqual([]);
    expect(getImageProbeAttachmentsById('session-persisted', [stored[0]!.id])).toMatchObject([
      { id: stored[0]!.id, data, mimeType: 'image/png', name: 'persisted.png' },
    ]);
  });

  it('rejects excessive image counts and oversized images', () => {
    const data = pngData('ok');
    expect(() =>
      rememberImageProbeAttachments(
        'session-many',
        Array.from({ length: MAX_IMAGE_PROBE_ATTACHMENTS_PER_PROMPT + 1 }, (_, index) => ({
          type: 'image' as const,
          data,
          mimeType: 'image/png',
          name: `image-${index}.png`,
        })),
      ),
    ).toThrow(`at most ${MAX_IMAGE_PROBE_ATTACHMENTS_PER_PROMPT} images`);

    expect(() =>
      rememberImageProbeAttachments('session-large', [
        {
          type: 'image',
          data: Buffer.concat([pngHeader, Buffer.alloc(MAX_IMAGE_PROBE_IMAGE_BYTES)]).toString('base64'),
          mimeType: 'image/png',
          name: 'huge.png',
        },
      ]),
    ).toThrow('too large for image probing');
  });

  it('rejects files that are labelled as images but do not contain supported image bytes', () => {
    expect(() =>
      rememberImageProbeAttachments('session-invalid', [
        { type: 'image', data: Buffer.from('not-an-image').toString('base64'), mimeType: 'image/png', name: 'fake.png' },
      ]),
    ).toThrow('not a supported image file');
  });
});
