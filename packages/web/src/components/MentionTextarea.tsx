import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEventHandler, type TextareaHTMLAttributes } from 'react';
import { filterMentionItems, MAX_MENTION_MENU_ITEMS, type MentionItem } from '../conversation/conversationMentions';
import { useNodeMentionItems } from '../hooks/useNodeMentionItems';
import { Pill, cx } from './ui';

interface MentionMatch {
  query: string;
  start: number;
  end: number;
}

export type MentionTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  mentionItems?: MentionItem[];
  containerClassName?: string;
};

function findMentionMatch(value: string, caret: number, selectionEnd: number): MentionMatch | null {
  if (caret !== selectionEnd) {
    return null;
  }

  const prefix = value.slice(0, caret);
  const match = prefix.match(/(^|.*[\s(])(@[\w./-]*)$/);
  const query = match?.[2] ?? null;
  if (!query) {
    return null;
  }

  return {
    query,
    start: prefix.length - query.length,
    end: caret,
  };
}

export const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(function MentionTextarea({
  value,
  onValueChange,
  mentionItems,
  className,
  containerClassName,
  disabled,
  onKeyDown,
  onClick,
  onKeyUp,
  onBlur,
  ...rest
}, ref) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement, []);

  const { data } = useNodeMentionItems();
  const [mentionMatch, setMentionMatch] = useState<MentionMatch | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);

  const items = Array.isArray(mentionItems)
    ? mentionItems
    : Array.isArray(data)
      ? data
      : [];
  const filteredItems = useMemo(
    () => mentionMatch ? filterMentionItems(items, mentionMatch.query, { limit: MAX_MENTION_MENU_ITEMS }) : [],
    [items, mentionMatch],
  );
  const showMentionMenu = !disabled && mentionMatch !== null && filteredItems.length > 0;
  const selectedMentionIndex = filteredItems.length > 0 ? mentionIdx % filteredItems.length : -1;
  const selectedMentionRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    selectedMentionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedMentionIndex]);

  function updateMentionStateFromTextarea(element: HTMLTextAreaElement) {
    const nextMatch = findMentionMatch(element.value, element.selectionStart, element.selectionEnd);
    setMentionMatch(nextMatch);
    setMentionIdx(0);
  }

  function applyMention(item: MentionItem) {
    if (!mentionMatch) {
      return;
    }

    const nextValue = `${value.slice(0, mentionMatch.start)}${item.id} ${value.slice(mentionMatch.end)}`;
    const nextCaret = mentionMatch.start + item.id.length + 1;
    onValueChange(nextValue);
    setMentionMatch(null);
    setMentionIdx(0);

    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) {
        return;
      }

      element.focus();
      element.selectionStart = nextCaret;
      element.selectionEnd = nextCaret;
    });
  }

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (showMentionMenu) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIdx((current) => current + 1);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIdx((current) => Math.max(0, current - 1));
        return;
      }

      if ((event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey) {
        const selected = filteredItems[mentionIdx % filteredItems.length];
        if (selected) {
          event.preventDefault();
          applyMention(selected);
          return;
        }
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionMatch(null);
        setMentionIdx(0);
        return;
      }
    }

    onKeyDown?.(event);
  };

  return (
    <div className={cx('relative', containerClassName)}>
      {showMentionMenu && (
        <div className="ui-menu-shell absolute inset-x-0 bottom-full z-20 mb-2 max-h-72 overflow-y-auto">
          <div className="px-3 pt-2 pb-1">
            <p className="ui-section-label">Mention</p>
          </div>
          {filteredItems.map((item, index) => (
            <button
              key={`${item.kind}:${item.id}`}
              ref={index === selectedMentionIndex ? selectedMentionRef : undefined}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                applyMention(item);
              }}
              className={cx(
                'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors',
                index === selectedMentionIndex
                  ? 'bg-elevated text-primary'
                  : 'text-secondary hover:bg-elevated/50',
              )}
            >
              <Pill tone="muted">{item.kind}</Pill>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px] text-accent">{item.id}</p>
                {(item.summary || (item.title && item.title !== item.label)) && (
                  <p className="mt-0.5 truncate text-[12px] text-dim/90">{item.summary || item.title}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <textarea
        {...rest}
        ref={textareaRef}
        value={value}
        disabled={disabled}
        className={className}
        onChange={(event) => {
          onValueChange(event.target.value);
          updateMentionStateFromTextarea(event.target);
        }}
        onClick={(event) => {
          updateMentionStateFromTextarea(event.currentTarget);
          onClick?.(event);
        }}
        onKeyUp={(event) => {
          updateMentionStateFromTextarea(event.currentTarget);
          onKeyUp?.(event);
        }}
        onBlur={(event) => {
          setMentionMatch(null);
          setMentionIdx(0);
          onBlur?.(event);
        }}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
});
