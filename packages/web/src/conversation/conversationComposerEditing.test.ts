import { describe, expect, it } from 'vitest';
import {
  canNavigateComposerHistoryValue,
  insertTextAtComposerSelection,
  resolveComposerClearShortcut,
  resolveComposerHistoryNavigation,
} from './conversationComposerEditing';

describe('conversation composer editing helpers', () => {
  it('resolves the composer clear keyboard shortcut', () => {
    expect(resolveComposerClearShortcut({
      key: 'c',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      isComposing: false,
      composerInput: '  hello  ',
      attachmentCount: 1,
      drawingAttachmentCount: 0,
    })).toEqual({ shouldClear: true, shouldRememberInput: true });

    expect(resolveComposerClearShortcut({
      key: 'c',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      isComposing: false,
      composerInput: '   ',
      attachmentCount: 0,
      drawingAttachmentCount: 1,
    })).toEqual({ shouldClear: true, shouldRememberInput: false });

    expect(resolveComposerClearShortcut({
      key: 'c',
      ctrlKey: true,
      metaKey: true,
      altKey: false,
      shiftKey: false,
      isComposing: false,
      composerInput: 'hello',
      attachmentCount: 0,
      drawingAttachmentCount: 0,
    })).toEqual({ shouldClear: false, shouldRememberInput: false });
  });

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

  it('resolves composer history navigation without owning React state', () => {
    expect(resolveComposerHistoryNavigation({
      direction: 'older',
      history: ['first', 'second'],
      currentIndex: null,
      currentInput: 'draft',
      draftInput: '',
    })).toEqual({
      nextIndex: 1,
      nextInput: 'second',
      nextDraftInput: 'draft',
    });

    expect(resolveComposerHistoryNavigation({
      direction: 'older',
      history: ['first', 'second'],
      currentIndex: 1,
      currentInput: 'second',
      draftInput: 'draft',
    })).toEqual({
      nextIndex: 0,
      nextInput: 'first',
      nextDraftInput: 'draft',
    });

    expect(resolveComposerHistoryNavigation({
      direction: 'newer',
      history: ['first', 'second'],
      currentIndex: 0,
      currentInput: 'first',
      draftInput: 'draft',
    })).toEqual({
      nextIndex: 1,
      nextInput: 'second',
      nextDraftInput: 'draft',
    });

    expect(resolveComposerHistoryNavigation({
      direction: 'newer',
      history: ['first', 'second'],
      currentIndex: 1,
      currentInput: 'second',
      draftInput: 'draft',
    })).toEqual({
      nextIndex: null,
      nextInput: 'draft',
      nextDraftInput: '',
    });
  });

  it('does not navigate composer history when there is nowhere to go', () => {
    expect(resolveComposerHistoryNavigation({
      direction: 'older',
      history: [],
      currentIndex: null,
      currentInput: 'draft',
      draftInput: '',
    })).toBeNull();

    expect(resolveComposerHistoryNavigation({
      direction: 'newer',
      history: ['first'],
      currentIndex: null,
      currentInput: 'draft',
      draftInput: '',
    })).toBeNull();
  });
});
