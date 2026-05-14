// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposerAttachmentShelf } from './ComposerAttachmentShelf';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];
const createObjectURLMock = vi.fn();
const revokeObjectURLMock = vi.fn();

const imageAttachment = {
  localId: 'image-1',
  name: 'Screenshot 2026-04-22.png',
  mimeType: 'image/png',
  data: 'cHJldmlldw==',
  previewUrl: 'data:image/png;base64,cHJldmlldw==',
  size: 7,
};

function renderShelf(overrides: Partial<React.ComponentProps<typeof ComposerAttachmentShelf>> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const onRemoveAttachment = vi.fn();
  const onEditDrawing = vi.fn();
  const onRemoveDrawingAttachment = vi.fn();

  act(() => {
    root.render(
      <ComposerAttachmentShelf
        attachments={[]}
        drawingAttachments={[]}
        onRemoveAttachment={onRemoveAttachment}
        onEditDrawing={onEditDrawing}
        onRemoveDrawingAttachment={onRemoveDrawingAttachment}
        {...overrides}
      />,
    );
  });

  mountedRoots.push(root);
  return { container, onRemoveAttachment, onEditDrawing, onRemoveDrawingAttachment, root };
}

function click(target: Element | null) {
  if (!(target instanceof HTMLElement)) {
    throw new Error('Expected HTMLElement target');
  }

  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('ComposerAttachmentShelf', () => {
  beforeEach(() => {
    createObjectURLMock.mockReset();
    revokeObjectURLMock.mockReset();
    createObjectURLMock.mockReturnValue('blob:composer-preview');
    Object.assign(globalThis.URL, {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    });
  });

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
  });

  it('opens an image preview for composer image attachments without touching the original file', () => {
    const { container } = renderShelf({ attachments: [imageAttachment] });

    click(container.querySelector('button[aria-label="Preview Screenshot 2026-04-22.png"]'));

    expect(createObjectURLMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"][aria-label="Screenshot 2026-04-22.png"]')).not.toBeNull();

    click(container.querySelector('button[aria-label="Close image preview"]'));

    expect(revokeObjectURLMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens an image preview for drawing attachments', () => {
    const { container } = renderShelf({
      drawingAttachments: [
        {
          localId: 'drawing-1',
          title: 'Wireframe',
          revision: 3,
          dirty: false,
          previewUrl: 'data:image/png;base64,ZmFrZQ==',
        },
      ],
    });

    click(container.querySelector('button[aria-label="Preview Wireframe (rev 3)"]'));

    expect(container.querySelector('[role="dialog"][aria-label="Wireframe (rev 3)"]')).not.toBeNull();
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });

  it('keeps remove actions wired up', () => {
    const { container, onRemoveAttachment, onRemoveDrawingAttachment } = renderShelf({
      attachments: [imageAttachment],
      drawingAttachments: [
        {
          localId: 'drawing-1',
          title: 'Wireframe',
          dirty: true,
          previewUrl: 'data:image/png;base64,ZmFrZQ==',
        },
      ],
    });

    click(container.querySelector('button[title="Remove Screenshot 2026-04-22.png"]'));
    click(container.querySelector('button[title="Remove Wireframe"]'));

    expect(onRemoveAttachment).toHaveBeenCalledWith(0);
    expect(onRemoveDrawingAttachment).toHaveBeenCalledWith('drawing-1');
  });
});
