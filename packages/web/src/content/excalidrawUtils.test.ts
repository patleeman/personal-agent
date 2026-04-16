import { describe, expect, it } from 'vitest';
import { resolveExcalidrawPreviewFrameSize } from './excalidrawUtils';

describe('resolveExcalidrawPreviewFrameSize', () => {
  it('returns null when viewport dimensions are missing', () => {
    expect(resolveExcalidrawPreviewFrameSize({} as never)).toBeNull();
    expect(resolveExcalidrawPreviewFrameSize(null)).toBeNull();
  });

  it('caps large editor viewports to the preview max size', () => {
    expect(resolveExcalidrawPreviewFrameSize({ width: 2400, height: 1200 } as never)).toEqual({
      width: 1600,
      height: 800,
    });
  });

  it('upscales small editor viewports to the preview minimum size', () => {
    expect(resolveExcalidrawPreviewFrameSize({ width: 450, height: 300 } as never)).toEqual({
      width: 900,
      height: 600,
    });
  });

  it('keeps mid-sized editor viewports unchanged', () => {
    expect(resolveExcalidrawPreviewFrameSize({ width: 1200, height: 800 } as never)).toEqual({
      width: 1200,
      height: 800,
    });
  });
});
