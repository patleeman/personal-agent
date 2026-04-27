export interface ComposerSelectionRange {
  start: number;
  end: number;
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
