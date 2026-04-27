import { describe, expect, it } from 'vitest';
import {
  canNavigateComposerHistoryValue,
  insertTextAtComposerSelection,
} from './conversationComposerEditing';

describe('conversation composer editing helpers', () => {
  it('allows history navigation only from the first or last visual line with no selection', () => {
    expect(canNavigateComposerHistoryValue({
      value: 'first line\nsecond line',
      selectionStart: 5,
      selectionEnd: 5,
      key: 'ArrowUp',
    })).toBe(true);

    expect(canNavigateComposerHistoryValue({
      value: 'first line\nsecond line',
      selectionStart: 12,
      selectionEnd: 12,
      key: 'ArrowUp',
    })).toBe(false);

    expect(canNavigateComposerHistoryValue({
      value: 'first line\nsecond line',
      selectionStart: 15,
      selectionEnd: 15,
      key: 'ArrowDown',
    })).toBe(true);

    expect(canNavigateComposerHistoryValue({
      value: 'first line\nsecond line',
      selectionStart: 3,
      selectionEnd: 7,
      key: 'ArrowDown',
    })).toBe(false);
  });

  it('inserts trimmed text at the current selection with readable spacing', () => {
    expect(insertTextAtComposerSelection({
      currentInput: 'hello world',
      selection: { start: 6, end: 11 },
      text: '  Patrick  ',
    })).toEqual({
      nextInput: 'hello Patrick',
      nextCaret: 13,
    });

    expect(insertTextAtComposerSelection({
      currentInput: 'hello-world',
      selection: { start: 5, end: 5 },
      text: ' brave ',
    })).toEqual({
      nextInput: 'hello brave -world',
      nextCaret: 12,
    });
  });

  it('ignores empty insertions and clamps invalid selections', () => {
    expect(insertTextAtComposerSelection({
      currentInput: 'hello',
      selection: { start: 0, end: 0 },
      text: '   ',
    })).toBeNull();

    expect(insertTextAtComposerSelection({
      currentInput: 'hello',
      selection: { start: -10, end: 100 },
      text: 'bye',
    })).toEqual({
      nextInput: 'bye',
      nextCaret: 3,
    });
  });
});
