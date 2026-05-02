// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  buildReplySelectionScopeProps,
  findSelectionReplyScopeElement,
  findSelectionReplyScopeElements,
  getElementFromNode,
  readSelectedTextWithinElement,
} from './replySelection.js';

describe('replySelection', () => {
  it('resolves reply scope elements from nested nodes', () => {
    document.body.innerHTML = '<section data-selection-reply-scope="assistant-message"><p><span>hello</span></p></section>';
    const scope = document.querySelector('section') as HTMLElement;
    const span = document.querySelector('span') as HTMLElement;
    const textNode = span.firstChild as Text;

    expect(getElementFromNode(textNode)).toBe(span);
    expect(findSelectionReplyScopeElement(textNode)).toBe(scope);
  });

  it('reads only the selected text that intersects the scope element', () => {
    document.body.innerHTML = '<div id="before">before </div><section data-selection-reply-scope="assistant-message"><p>first line</p><p>second line</p></section><div id="after"> after</div>';
    const before = document.querySelector('#before') as HTMLElement;
    const scope = document.querySelector('section') as HTMLElement;
    const after = document.querySelector('#after') as HTMLElement;

    const range = document.createRange();
    range.setStart(before.firstChild as Text, 0);
    range.setEnd(after.firstChild as Text, 6);

    expect(readSelectedTextWithinElement(scope, range)).toBe('first linesecond line');
  });

  it('returns empty text when the range does not overlap the scope element', () => {
    document.body.innerHTML = '<section data-selection-reply-scope="assistant-message">inside</section><p>outside</p>';
    const scope = document.querySelector('section') as HTMLElement;
    const outside = document.querySelector('p') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(outside);

    expect(readSelectedTextWithinElement(scope, range)).toBe('');
  });

  it('finds selection start and end scopes with range fallback', () => {
    document.body.innerHTML = '<section data-selection-reply-scope="assistant-message">start</section><section data-selection-reply-scope="assistant-message">end</section>';
    const scopes = Array.from(document.querySelectorAll('section')) as HTMLElement[];
    const range = document.createRange();
    range.setStart(scopes[0].firstChild as Text, 0);
    range.setEnd(scopes[1].firstChild as Text, 3);

    const selection = window.getSelection();
    if (!selection) {
      throw new Error('missing selection');
    }
    selection.removeAllRanges();
    selection.addRange(range);

    expect(findSelectionReplyScopeElements(selection, range)).toEqual({
      startScope: scopes[0],
      endScope: scopes[1],
    });
  });

  it('builds stable scope props and forwards gesture target', () => {
    const target = document.createElement('section');
    const onGesture = vi.fn();
    const props = buildReplySelectionScopeProps(2, 'block-1', onGesture);

    expect(props['data-selection-reply-scope']).toBe('assistant-message');
    expect(props['data-message-index']).toBe('2');
    expect(props['data-block-id']).toBe('block-1');

    props.onMouseUp?.({ currentTarget: target } as never);
    expect(onGesture).toHaveBeenCalledWith(target);
  });
});
