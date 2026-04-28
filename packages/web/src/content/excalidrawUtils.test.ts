import { describe, expect, it } from 'vitest';
import { resolveExcalidrawPreviewFrameSize } from './excalidrawUtils.js';

describe('resolveExcalidrawPreviewFrameSize', () => {
  it('rejects unsafe persisted canvas dimensions', () => {
    expect(resolveExcalidrawPreviewFrameSize({
      width: Number.MAX_SAFE_INTEGER + 1,
      height: 720,
    } as never)).toBeNull();
    expect(resolveExcalidrawPreviewFrameSize({
      width: 1280,
      height: Number.MAX_SAFE_INTEGER + 1,
    } as never)).toBeNull();
  });

  it('rejects fractional persisted canvas dimensions', () => {
    expect(resolveExcalidrawPreviewFrameSize({
      width: 1280.5,
      height: 720,
    } as never)).toBeNull();
    expect(resolveExcalidrawPreviewFrameSize({
      width: 1280,
      height: 720.5,
    } as never)).toBeNull();
  });
});
