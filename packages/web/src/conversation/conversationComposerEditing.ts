export interface ComposerSelectionRange {
  start: number;
  end: number;
}

export function resolveComposerClearShortcut(input: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  composerInput: string;
  attachmentCount: number;
  drawingAttachmentCount: number;
}): {
  shouldClear: boolean;
  shouldRememberInput: boolean;
} {
  const isClearShortcut = input.ctrlKey
    && !input.metaKey
    && !input.altKey
    && !input.shiftKey
    && input.key.toLowerCase() === 'c'
    && !input.isComposing;

  if (!isClearShortcut) {
    return { shouldClear: false, shouldRememberInput: false };
  }

  return {
    shouldClear: input.composerInput.length > 0 || input.attachmentCount > 0 || input.drawingAttachmentCount > 0,
    shouldRememberInput: input.composerInput.trim().length > 0,
  };
}

export function canNavigateComposerHistoryValue(input: {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  key: 'ArrowUp' | 'ArrowDown';
}): boolean {
  if (input.selectionStart !== input.selectionEnd) {
    return false;
  }

  const caret = input.selectionStart;
  return input.key === 'ArrowUp'
    ? !input.value.slice(0, caret).includes('\n')
    : !input.value.slice(caret).includes('\n');
}

export function insertTextAtComposerSelection(input: {
  currentInput: string;
  selection: ComposerSelectionRange;
  text: string;
}): {
  nextInput: string;
  nextCaret: number;
} | null {
  const normalizedText = input.text.trim();
  if (!normalizedText) {
    return null;
  }

  const start = Math.max(0, Math.min(input.selection.start, input.currentInput.length));
  const end = Math.max(start, Math.min(input.selection.end, input.currentInput.length));
  const before = input.currentInput.slice(0, start);
  const after = input.currentInput.slice(end);
  const leadingSpace = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const trailingSpace = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
  const inserted = `${leadingSpace}${normalizedText}${trailingSpace}`;
  const nextInput = `${before}${inserted}${after}`;
  const nextCaret = before.length + inserted.length;

  return { nextInput, nextCaret };
}

export function resolveComposerHistoryNavigation(input: {
  direction: 'older' | 'newer';
  history: string[];
  currentIndex: number | null;
  currentInput: string;
  draftInput: string;
}): {
  nextIndex: number | null;
  nextInput: string;
  nextDraftInput: string;
} | null {
  if (input.history.length === 0) {
    return null;
  }

  if (input.direction === 'older') {
    const nextIndex = input.currentIndex === null
      ? input.history.length - 1
      : Math.max(0, input.currentIndex - 1);

    return {
      nextIndex,
      nextInput: input.history[nextIndex] ?? '',
      nextDraftInput: input.currentIndex === null ? input.currentInput : input.draftInput,
    };
  }

  if (input.currentIndex === null) {
    return null;
  }

  if (input.currentIndex >= input.history.length - 1) {
    return {
      nextIndex: null,
      nextInput: input.draftInput,
      nextDraftInput: '',
    };
  }

  const nextIndex = input.currentIndex + 1;
  return {
    nextIndex,
    nextInput: input.history[nextIndex] ?? '',
    nextDraftInput: input.draftInput,
  };
}
