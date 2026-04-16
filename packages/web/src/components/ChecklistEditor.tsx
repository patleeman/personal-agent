import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  appendChecklistPresetItems,
  createChecklistDraftItem,
  type ChecklistDraftItem,
} from '../checklists';
import { fuzzyScore } from '../commands/slashMenu';
import type {
  ConversationAutomationSkillInfo,
  ConversationAutomationWorkflowPreset,
} from '../types';
import { IconButton, cx } from './ui';

const ITEM_TEXTAREA_CLASS = 'w-full min-h-[24px] resize-none border-0 bg-transparent px-0 py-0 text-[14px] leading-6 text-primary placeholder:text-dim/70 focus:outline-none disabled:opacity-50';
const COMPOSER_TEXTAREA_CLASS = 'min-w-0 flex-1 bg-transparent text-[13px] leading-5 text-primary placeholder:text-dim outline-none resize-none disabled:cursor-default disabled:text-dim';
const ITEM_PLACEHOLDER = 'Type anything the agent should do. You can use /skill:..., slash commands, or plain text.';
const ITEM_PREVIEW_LINE_COUNT = 3;
const ITEM_FALLBACK_LINE_HEIGHT_PX = 24;
const CHECKED_ITEM_TEXT_STYLE = {
  textDecorationColor: 'rgb(var(--color-primary) / 0.72)',
  textDecorationThickness: '2px',
  textDecorationSkipInk: 'none' as const,
};

interface TodoComposerMenuItem {
  key: string;
  kind: 'skill' | 'preset';
  displayCmd: string;
  insertText: string;
  description: string;
}

export interface ChecklistItemState {
  checked?: boolean;
  active?: boolean;
  locked?: boolean;
  supportText?: string | null;
}

function moveDraftItem(items: ChecklistDraftItem[], itemId: string, targetItemId: string): ChecklistDraftItem[] {
  if (itemId === targetItemId) {
    return items;
  }

  const sourceIndex = items.findIndex((item) => item.id === itemId);
  const targetIndex = items.findIndex((item) => item.id === targetItemId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) {
    return items;
  }

  next.splice(targetIndex, 0, moved);
  return next;
}

function normalizeSlashQuery(value: string): string {
  return value.trim().startsWith('/') ? value.trim().slice(1).toLowerCase() : '';
}

function explicitInsertQuery(query: string, kind: 'skill' | 'preset'): string | null {
  const trimmed = query.trim();
  const prefix = `/${kind}`;
  if (!trimmed.toLowerCase().startsWith(prefix)) {
    return null;
  }

  const remainder = trimmed.slice(prefix.length);
  if (remainder.length === 0) {
    return '';
  }

  if (remainder.startsWith(':') || remainder.startsWith(' ')) {
    return remainder.slice(1).trim().toLowerCase();
  }

  return null;
}

function bestScore(query: string, candidates: string[]): number | null {
  if (query.length === 0) {
    return 0;
  }

  let result: number | null = null;
  for (const candidate of candidates) {
    const score = fuzzyScore(query, candidate);
    if (score !== null && (result === null || score > result)) {
      result = score;
    }
  }

  return result;
}

function buildComposerMenuItems(
  query: string,
  skills: ConversationAutomationSkillInfo[],
  presets: ConversationAutomationWorkflowPreset[],
): TodoComposerMenuItem[] {
  const normalized = normalizeSlashQuery(query);
  if (normalized.length === 0 && !query.trim().startsWith('/')) {
    return [];
  }

  const skillQuery = explicitInsertQuery(query, 'skill');
  const presetQuery = explicitInsertQuery(query, 'preset');
  const genericQuery = normalized;

  const skillItems: Array<{ key: string; score: number; item: TodoComposerMenuItem }> = [];
  for (const skill of presetQuery === null ? skills : []) {
    const score = bestScore(skillQuery ?? genericQuery, [
      `skill:${skill.name}`,
      skill.name,
      skill.description,
    ]);

    if (score === null) {
      continue;
    }

    skillItems.push({
      key: `skill:${skill.name}`,
      score,
      item: {
        key: `skill:${skill.name}`,
        kind: 'skill',
        displayCmd: `/skill:${skill.name}`,
        insertText: `/skill:${skill.name}`,
        description: skill.description,
      },
    });
  }

  const presetItems: Array<{ key: string; score: number; item: TodoComposerMenuItem }> = [];
  for (const preset of skillQuery === null ? presets : []) {
    const score = bestScore(presetQuery ?? genericQuery, [
      `preset:${preset.name}`,
      preset.name,
      `${preset.items.length} ${preset.items.length === 1 ? 'item' : 'items'}`,
    ]);

    if (score === null) {
      continue;
    }

    presetItems.push({
      key: `preset:${preset.id}`,
      score,
      item: {
        key: `preset:${preset.id}`,
        kind: 'preset',
        displayCmd: `/preset:${preset.name}`,
        insertText: `/preset:${preset.name}`,
        description: `${preset.items.length} ${preset.items.length === 1 ? 'item' : 'items'}`,
      },
    });
  }

  return [...skillItems, ...presetItems]
    .sort((left, right) => right.score - left.score || left.item.displayCmd.localeCompare(right.item.displayCmd))
    .slice(0, 8)
    .map((entry) => entry.item);
}

function resolvePresetShortcut(
  text: string,
  presets: ConversationAutomationWorkflowPreset[],
):
  | { kind: 'none' }
  | { kind: 'missing' }
  | { kind: 'missingPreset'; query: string }
  | { kind: 'preset'; preset: ConversationAutomationWorkflowPreset } {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/preset(?:[:\s]+)?(.*)$/i);
  if (!match) {
    return { kind: 'none' };
  }

  const query = match[1]?.trim() ?? '';
  if (!query) {
    return { kind: 'missing' };
  }

  const normalized = query.toLowerCase();
  const preset = presets.find((candidate) => (
    candidate.name.trim().toLowerCase() === normalized || candidate.id.trim().toLowerCase() === normalized
  ));

  return preset
    ? { kind: 'preset', preset }
    : { kind: 'missingPreset', query };
}

function ComposerMenu({
  items,
  index,
  onSelect,
}: {
  items: TodoComposerMenuItem[];
  index: number;
  onSelect: (item: TodoComposerMenuItem) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="ui-menu-shell max-h-[18rem] overflow-y-auto py-1.5">
      {items.map((item, itemIndex) => {
        const active = itemIndex === index % items.length;
        return (
          <button
            key={item.key}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(item);
            }}
            className={cx(
              'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors',
              active ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50',
            )}
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle text-[10px] text-dim/80">
              {item.kind === 'skill' ? '✦' : '≡'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[12px] text-accent">{item.displayCmd}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-dim/60">{item.kind}</span>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-dim/90">{item.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function ChecklistComposer({
  currentItems,
  skills,
  presets,
  disabled = false,
  placeholder = 'Add an item… /skill:... or /preset:...',
  onAdd,
  onErrorChange,
}: {
  currentItems: ChecklistDraftItem[];
  skills: ConversationAutomationSkillInfo[];
  presets: ConversationAutomationWorkflowPreset[];
  disabled?: boolean;
  placeholder?: string;
  onAdd: (nextItems: ChecklistDraftItem[]) => Promise<void> | void;
  onErrorChange?: (message: string | null) => void;
}) {
  const [composerText, setComposerText] = useState('');
  const [composerMenuIndex, setComposerMenuIndex] = useState(0);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!composerTextareaRef.current) {
      return;
    }

    const element = composerTextareaRef.current;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 128)}px`;
  }, [composerText]);

  const composerMenuItems = useMemo(
    () => buildComposerMenuItems(composerText, skills, presets),
    [composerText, presets, skills],
  );
  const showComposerMenu = composerText.trim().startsWith('/') && composerMenuItems.length > 0;

  function applyComposerMenuItem(item: TodoComposerMenuItem) {
    setComposerText(item.insertText);
    setComposerMenuIndex(0);
    requestAnimationFrame(() => composerTextareaRef.current?.focus());
  }

  async function handleAddComposerItem() {
    const trimmed = composerText.trim();
    if (!trimmed || disabled) {
      return;
    }

    const presetShortcut = resolvePresetShortcut(trimmed, presets);
    if (presetShortcut.kind === 'missing') {
      onErrorChange?.('Choose a preset to add.');
      return;
    }
    if (presetShortcut.kind === 'missingPreset') {
      onErrorChange?.(`No preset named “${presetShortcut.query}”.`);
      return;
    }

    const nextItems = presetShortcut.kind === 'preset'
      ? appendChecklistPresetItems(currentItems, presetShortcut.preset)
      : [...currentItems, createChecklistDraftItem(trimmed)];

    onErrorChange?.(null);
    setComposerText('');
    setComposerMenuIndex(0);
    await onAdd(nextItems);
    requestAnimationFrame(() => composerTextareaRef.current?.focus());
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showComposerMenu) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setComposerMenuIndex((current) => current + 1);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setComposerMenuIndex((current) => Math.max(0, current - 1));
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setComposerText('');
        setComposerMenuIndex(0);
        return;
      }

      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        const selected = composerMenuItems[composerMenuIndex % composerMenuItems.length];
        const exactMatch = selected && selected.insertText.trim().toLowerCase() === composerText.trim().toLowerCase();
        if (selected && (event.key === 'Tab' || !exactMatch)) {
          event.preventDefault();
          applyComposerMenuItem(selected);
          return;
        }
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleAddComposerItem();
    }
  }

  return (
    <div className="relative">
      {showComposerMenu && (
        <ComposerMenu
          items={composerMenuItems}
          index={composerMenuIndex}
          onSelect={applyComposerMenuItem}
        />
      )}

      <div className={cx(
        'ui-input-shell overflow-hidden',
        showComposerMenu ? 'border-accent/40 ring-1 ring-accent/15' : 'border-border-subtle',
      )}>
        <div className="flex items-end gap-2 px-3 py-2">
          <textarea
            ref={composerTextareaRef}
            value={composerText}
            onChange={(event) => {
              setComposerText(event.target.value);
              setComposerMenuIndex(0);
              onErrorChange?.(null);
            }}
            onKeyDown={handleComposerKeyDown}
            rows={1}
            disabled={disabled}
            className={COMPOSER_TEXTAREA_CLASS}
            placeholder={placeholder}
            title="Type / to insert a skill or preset"
            aria-label="Add checklist item"
            style={{ minHeight: '20px', maxHeight: '96px' }}
          />

          <button
            type="button"
            onClick={() => { void handleAddComposerItem(); }}
            disabled={disabled || composerText.trim().length === 0}
            className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/75 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function ChecklistItemTextField({
  item,
  checked,
  supportText,
  disabled,
  onChange,
  onBlur,
}: {
  item: ChecklistDraftItem;
  checked: boolean;
  supportText?: string | null;
  disabled: boolean;
  onChange: (nextText: string) => void;
  onBlur: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }

    element.style.height = 'auto';
    const computedLineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight);
    const lineHeight = Number.isFinite(computedLineHeight) ? computedLineHeight : ITEM_FALLBACK_LINE_HEIGHT_PX;
    const collapsedHeight = Math.ceil(lineHeight * ITEM_PREVIEW_LINE_COUNT);
    const fullHeight = element.scrollHeight;
    const nextOverflowing = fullHeight > collapsedHeight + 1;
    const nextHeight = expanded ? fullHeight : Math.min(fullHeight, collapsedHeight);

    setOverflowing((current) => (current === nextOverflowing ? current : nextOverflowing));
    if (!nextOverflowing && expanded) {
      setExpanded(false);
    }

    element.style.height = `${Math.max(nextHeight, lineHeight)}px`;
  }, [expanded, item.text]);

  return (
    <div className="min-w-0">
      <textarea
        ref={textareaRef}
        value={item.text}
        rows={1}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onFocus={() => {
          if (overflowing) {
            setExpanded(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            (event.currentTarget as HTMLTextAreaElement).blur();
          }
        }}
        placeholder={ITEM_PLACEHOLDER}
        aria-label="Checklist item"
        className={cx(
          ITEM_TEXTAREA_CLASS,
          !expanded && overflowing && 'overflow-hidden',
          checked && 'text-dim line-through',
        )}
        style={checked ? CHECKED_ITEM_TEXT_STYLE : undefined}
        disabled={disabled}
      />
      {overflowing && (
        <button
          type="button"
          className="ui-action-button mt-1 text-[11px]"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
      {supportText && <p className="mt-0.5 break-words text-[11px] text-dim">{supportText}</p>}
    </div>
  );
}

export function ChecklistItemList({
  items,
  itemStates,
  textDisabled = false,
  structureDisabled = false,
  showCheckboxes = false,
  emptyState = 'Nothing here yet. Add the next step below.',
  onChange,
  onCommit,
  onToggleChecked,
}: {
  items: ChecklistDraftItem[];
  itemStates?: Record<string, ChecklistItemState>;
  textDisabled?: boolean;
  structureDisabled?: boolean;
  showCheckboxes?: boolean;
  emptyState?: ReactNode;
  onChange: (nextItems: ChecklistDraftItem[]) => void;
  onCommit?: (nextItems: ChecklistDraftItem[]) => Promise<void> | void;
  onToggleChecked?: (itemId: string, checked: boolean) => Promise<void> | void;
}) {
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);

  if (items.length === 0) {
    return <div className="px-3 py-4 text-[12px] text-dim">{emptyState}</div>;
  }

  return (
    <>
      {items.map((item) => {
        const state = itemStates?.[item.id] ?? {};
        const checked = Boolean(state.checked);
        const active = Boolean(state.active);
        const locked = Boolean(state.locked);
        const supportText = state.supportText;

        return (
          <div
            key={item.id}
            className={cx(
              'group grid items-start gap-x-2 px-3 py-2.5',
              showCheckboxes ? 'grid-cols-[auto_auto_minmax(0,1fr)_auto]' : 'grid-cols-[auto_minmax(0,1fr)_auto]',
              'border-b border-border-subtle/70 last:border-b-0',
              draggingItemId === item.id && 'opacity-60',
              active && 'bg-accent/[0.05]',
            )}
            onDragOver={(event) => {
              if (!draggingItemId || draggingItemId === item.id || locked || structureDisabled) {
                return;
              }
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (!draggingItemId || draggingItemId === item.id || locked || structureDisabled) {
                return;
              }
              const nextItems = moveDraftItem(items, draggingItemId, item.id);
              onChange(nextItems);
              setDraggingItemId(null);
              void onCommit?.(nextItems);
            }}
          >
            <button
              type="button"
              draggable={!locked && !structureDisabled}
              onDragStart={() => setDraggingItemId(item.id)}
              onDragEnd={() => setDraggingItemId(null)}
              className="mt-1 inline-flex h-5 w-4 items-center justify-center text-dim/55 opacity-0 transition hover:text-secondary focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-20"
              title="Drag to reorder"
              aria-label="Drag to reorder"
              disabled={locked || structureDisabled}
            >
              <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
                <circle cx="2" cy="2" r="1.1" />
                <circle cx="8" cy="2" r="1.1" />
                <circle cx="2" cy="7" r="1.1" />
                <circle cx="8" cy="7" r="1.1" />
                <circle cx="2" cy="12" r="1.1" />
                <circle cx="8" cy="12" r="1.1" />
              </svg>
            </button>

            {showCheckboxes && onToggleChecked && (
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => { void onToggleChecked(item.id, !checked); }}
                disabled={locked || structureDisabled}
                className={cx(
                  'mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                  checked
                    ? 'border-accent bg-accent text-white'
                    : 'border-border-default text-transparent hover:border-accent/55',
                  locked || structureDisabled ? 'opacity-50' : '',
                )}
                title={checked ? 'Mark incomplete' : 'Mark complete'}
                aria-label={checked ? 'Mark incomplete' : 'Mark complete'}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 12 5 5L20 7" />
                </svg>
              </button>
            )}

            <ChecklistItemTextField
              item={item}
              checked={checked}
              supportText={supportText}
              disabled={locked || textDisabled}
              onChange={(nextText) => {
                onChange(items.map((candidate) => candidate.id === item.id ? { ...candidate, text: nextText } : candidate));
              }}
              onBlur={() => { void onCommit?.(items); }}
            />

            <IconButton
              compact
              onClick={() => {
                const nextItems = items.filter((candidate) => candidate.id !== item.id);
                onChange(nextItems);
                void onCommit?.(nextItems);
              }}
              disabled={locked || structureDisabled}
              className="mt-0.5 text-danger/70 opacity-0 transition hover:text-danger focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
              title="Remove item"
              aria-label="Remove item"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </IconButton>
          </div>
        );
      })}
    </>
  );
}
