export interface ComposerSelectionRange {
  start: number;
  end: number;
}

function normalizeComposerSelectionIndex(value: number, fallback: number, max: number): number {
  if (!Number.isSafeInteger(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(value, max));
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
  const isClearShortcut =
    input.ctrlKey && !input.metaKey && !input.altKey && !input.shiftKey && input.key.toLowerCase() === 'c' && !input.isComposing;

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
  return input.key === 'ArrowUp' ? !input.value.slice(0, caret).includes('\n') : !input.value.slice(caret).includes('\n');
}

export function insertTextAtComposerSelection(input: { currentInput: string; selection: ComposerSelectionRange; text: string }): {
  nextInput: string;
  nextCaret: number;
} | null {
  const normalizedText = input.text.trim();
  if (!normalizedText) {
    return null;
  }

  const start = normalizeComposerSelectionIndex(input.selection.start, input.currentInput.length, input.currentInput.length);
  const end = Math.max(start, normalizeComposerSelectionIndex(input.selection.end, start, input.currentInput.length));
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
  const currentIndex =
    input.currentIndex === null || !Number.isSafeInteger(input.currentIndex)
      ? null
      : Math.max(0, Math.min(input.currentIndex, input.history.length - 1));

  if (input.direction === 'older') {
    const nextIndex = currentIndex === null ? input.history.length - 1 : Math.max(0, currentIndex - 1);

    return {
      nextIndex,
      nextInput: input.history[nextIndex] ?? '',
      nextDraftInput: currentIndex === null ? input.currentInput : input.draftInput,
    };
  }

  if (currentIndex === null) {
    return null;
  }

  if (currentIndex >= input.history.length - 1) {
    return {
      nextIndex: null,
      nextInput: input.draftInput,
      nextDraftInput: '',
    };
  }

  const nextIndex = currentIndex + 1;
  return {
    nextIndex,
    nextInput: input.history[nextIndex] ?? '',
    nextDraftInput: input.draftInput,
  };
}
