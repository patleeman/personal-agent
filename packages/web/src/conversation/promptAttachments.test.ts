import { describe, expect, it } from 'vitest';
import {
  base64ToFile,
  constrainPromptImageDimensions,
  drawingAttachmentToPromptImage,
  drawingAttachmentToPromptRef,
  fileExtensionForMimeType,
  isPotentialExcalidrawFile,
  prepareComposerFiles,
  restoreComposerImageFiles,
  restoreQueuedImageFiles,
  screenshotCaptureImageToFile,
  type ComposerDrawingAttachment,
} from './promptAttachments.js';

describe('promptAttachments', () => {
  it('constrains prompt images to the provider long-side limit', () => {
    expect(constrainPromptImageDimensions(1600, 900)).toEqual({ width: 1600, height: 900 });
    expect(constrainPromptImageDimensions(4000, 1000)).toEqual({ width: 2000, height: 500 });
    expect(constrainPromptImageDimensions(1200, 3600)).toEqual({ width: 667, height: 2000 });
  });

  it('restores queued and composer images with stable fallback names', async () => {
    const restoredQueued = restoreQueuedImageFiles([
      { data: globalThis.btoa('hello'), mimeType: 'image/jpeg', previewUrl: 'data:image/jpeg;base64,aGVsbG8=' },
    ], 'followUp', 1);
    const restoredComposer = restoreComposerImageFiles([
      { data: globalThis.btoa('hello'), mimeType: 'image/png', previewUrl: 'data:image/png;base64,aGVsbG8=' },
    ], 'draft-image');

    expect(restoredQueued[0]?.name).toBe('queued-followUp-2-1.jpg');
    expect(restoredQueued[0]?.type).toBe('image/jpeg');
    expect(await restoredQueued[0]?.text()).toBe('hello');
    expect(restoredComposer[0]?.name).toBe('draft-image-1.png');
  });

  it('detects Excalidraw-compatible files before parsing them', () => {
    expect(isPotentialExcalidrawFile(new File(['{}'], 'scene.excalidraw', { type: '' }))).toBe(true);
    expect(isPotentialExcalidrawFile(new File(['{}'], 'scene.png', { type: 'image/png' }))).toBe(true);
    expect(isPotentialExcalidrawFile(new File(['{}'], 'scene.json', { type: 'application/json' }))).toBe(true);
    expect(isPotentialExcalidrawFile(new File(['text'], 'notes.txt', { type: 'text/plain' }))).toBe(false);
  });

  it('prepares mixed composer files into images, drawings, parse failures, and rejects', async () => {
    const drawing = {
      localId: 'drawing-1',
      title: 'Sketch',
      sourceData: '{}',
      sourceMimeType: 'application/vnd.excalidraw+json',
      sourceName: 'Sketch.excalidraw',
      previewData: 'abc',
      previewMimeType: 'image/png',
      previewName: 'Sketch.png',
      previewUrl: 'data:image/png;base64,abc',
      dirty: true,
    } as ComposerDrawingAttachment;
    const image = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
    const parsedDrawing = new File(['{}'], 'sketch.excalidraw', { type: '' });
    const brokenDrawing = new File(['bad'], 'broken.excalidraw', { type: '' });
    const rejected = new File(['notes'], 'notes.txt', { type: 'text/plain' });

    const result = await prepareComposerFiles([
      image,
      parsedDrawing,
      brokenDrawing,
      rejected,
    ], async (file) => {
      if (file.name === 'broken.excalidraw') {
        throw new Error('Invalid scene');
      }
      return drawing;
    });

    expect(result.imageFiles).toEqual([image]);
    expect(result.drawingAttachments).toEqual([drawing]);
    expect(result.drawingParseFailures).toEqual([{ fileName: 'broken.excalidraw', message: 'Invalid scene' }]);
    expect(result.rejectedFileNames).toEqual(['notes.txt']);
  });

  it('falls back to image attachment when png drawing parsing fails', async () => {
    const image = new File(['image'], 'maybe-drawing.png', { type: 'image/png' });

    const result = await prepareComposerFiles([image], async () => {
      throw new Error('No embedded scene');
    });

    expect(result.imageFiles).toEqual([image]);
    expect(result.drawingAttachments).toEqual([]);
    expect(result.drawingParseFailures).toEqual([]);
    expect(result.rejectedFileNames).toEqual([]);
  });

  it('converts drawing attachments to prompt image and attachment references', () => {
    const drawing = {
      localId: 'drawing-1',
      title: 'Sketch',
      sourceData: '{}',
      sourceMimeType: 'application/vnd.excalidraw+json',
      sourceName: 'Sketch.excalidraw',
      previewData: 'abc',
      previewMimeType: 'image/png',
      previewName: 'Sketch.png',
      previewUrl: 'data:image/png;base64,abc',
      attachmentId: 'attachment-1',
      revision: '2',
      dirty: false,
    } as ComposerDrawingAttachment;

    expect(drawingAttachmentToPromptImage(drawing)).toEqual({
      name: 'Sketch.png',
      mimeType: 'image/png',
      data: 'abc',
      previewUrl: 'data:image/png;base64,abc',
    });
    expect(drawingAttachmentToPromptRef(drawing)).toEqual({ attachmentId: 'attachment-1', revision: '2' });
    expect(drawingAttachmentToPromptRef({ ...drawing, attachmentId: undefined })).toBeNull();
  });

  it('keeps small binary helpers boring and predictable', async () => {
    const file = base64ToFile(globalThis.btoa('hello'), 'image/webp', 'image.webp');

    expect(file.name).toBe('image.webp');
    expect(file.type).toBe('image/webp');
    expect(await file.text()).toBe('hello');
    expect(fileExtensionForMimeType('image/jpeg')).toBe('jpg');
    expect(fileExtensionForMimeType('image/webp')).toBe('webp');
  });

  it('converts screenshot captures to composer files with a stable fallback name', async () => {
    const named = screenshotCaptureImageToFile({
      data: globalThis.btoa('screenshot'),
      mimeType: 'image/png',
      name: '  Capture.png  ',
    });
    const fallback = screenshotCaptureImageToFile({
      data: globalThis.btoa('fallback'),
      mimeType: 'image/png',
      name: '   ',
    });

    expect(named.name).toBe('Capture.png');
    expect(await named.text()).toBe('screenshot');
    expect(fallback.name).toBe('Screenshot.png');
    expect(await fallback.text()).toBe('fallback');
  });
});
