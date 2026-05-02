// @vitest-environment jsdom
import React, { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findPageSearchRanges, PageSearchBar } from './PageSearchBar';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];

function pressGlobalKey(key: string, options: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
  });
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

function renderHarness() {
  function Harness() {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [showExtraMatch, setShowExtraMatch] = useState(false);

    return (
      <>
        <div ref={rootRef}>
          <p>
            Alpha <strong>Beta</strong>
          </p>
          <p>alpha beta</p>
          {showExtraMatch ? <p>Later alpha beta addition</p> : null}
          <button type="button" onClick={() => setShowExtraMatch(true)}>
            Add match
          </button>
        </div>
        <PageSearchBar rootRef={rootRef} />
      </>
    );
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
  mountedRoots.push(root);
  return { container };
}

describe('PageSearchBar', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((handle: number) => window.clearTimeout(handle)) as typeof window.cancelAnimationFrame;
  });

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('finds case-insensitive matches across inline nodes', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha <strong>Beta</strong></p><p>gamma</p><p>alpha beta</p>';
    document.body.appendChild(container);

    const ranges = findPageSearchRanges(container, 'alpha beta');

    expect(ranges).toHaveLength(2);
    expect(ranges.map((range) => range.toString())).toEqual(['Alpha Beta', 'alpha beta']);
  });

  it('opens from Ctrl+F and cycles through the current matches', async () => {
    const { container } = renderHarness();

    pressGlobalKey('f', { ctrlKey: true });
    await flushAsyncWork();

    const input = container.querySelector('input[aria-label="Find on page"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (!valueSetter) {
      throw new Error('HTMLInputElement value setter unavailable');
    }

    await act(async () => {
      valueSetter.call(input, 'alpha beta');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushAsyncWork();

    expect(container.textContent).toContain('1/2');

    const nextButton = container.querySelector('button[aria-label="Next match"]');
    expect(nextButton).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      (nextButton as HTMLButtonElement).click();
      await flushAsyncWork();
    });

    expect(container.textContent).toContain('2/2');

    const previousButton = container.querySelector('button[aria-label="Previous match"]');
    expect(previousButton).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      (previousButton as HTMLButtonElement).click();
      await flushAsyncWork();
    });

    expect(container.textContent).toContain('1/2');
  });
});
