import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import {
  appendChecklistPresetItems,
  checklistDraftItemsToTemplateItems,
  createChecklistDraftItem,
  type ChecklistDraftItem,
  toChecklistDraftItems,
} from '../checklists';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import { fuzzyScore } from '../slashMenu';
import type {
  ConversationAutomationResponse,
  ConversationAutomationSkillInfo,
  ConversationAutomationTodoItem,
  ConversationAutomationWorkflowPreset,
} from '../types';
import { ErrorState, IconButton, LoadingState, SurfacePanel, cx } from './ui';

const ITEM_TEXTAREA_CLASS = 'w-full min-h-[24px] resize-none border-0 bg-transparent px-0 py-0 text-[14px] leading-6 text-primary placeholder:text-dim/70 focus:outline-none disabled:opacity-50';
const COMPOSER_TEXTAREA_CLASS = 'min-w-0 flex-1 bg-transparent text-[13px] leading-5 text-primary placeholder:text-dim outline-none resize-none disabled:cursor-default disabled:text-dim';

type PendingAction = 'save' | 'toggle' | null;

interface TodoComposerMenuItem {
  key: string;
  kind: 'skill' | 'preset';
  displayCmd: string;
  insertText: string;
  description: string;
}

function buildProgressLabel(automation: ConversationAutomationResponse['automation']): string {
  if (automation.items.length === 0) {
    return 'No items';
  }

  const completed = automation.items.filter((item) => item.status === 'completed').length;
  const running = automation.items.find((item) => item.status === 'running');
  if (running) {
    return `${completed}/${automation.items.length} complete · running ${running.label}`;
  }

  if (automation.waitingForUser) {
    return `${completed}/${automation.items.length} complete · waiting on you`;
  }

  if (completed === automation.items.length) {
    return 'All complete';
  }

  return `${completed}/${automation.items.length} complete`;
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

function buildItemSupportText(item: ConversationAutomationTodoItem, active: boolean): string | null {
  const reason = item.resultReason?.trim();
  const genericCompletedReason = reason?.toLowerCase() === 'completed.';
  const supportText = reason && !(item.status === 'completed' && genericCompletedReason) ? reason : null;
  const parts: string[] = [];

  if (item.status === 'running') {
    parts.push(active ? 'Running now' : 'Running');
  } else if (item.status === 'waiting') {
    parts.push(active ? 'Waiting for you' : 'Waiting');
  } else if (item.status === 'blocked') {
    parts.push('Blocked');
  } else if (item.status === 'failed') {
    parts.push('Failed');
  } else if (active && item.status !== 'completed') {
    parts.push('Active');
  }

  if (supportText) {
    parts.push(supportText);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
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

export function ConversationAutomationPanel({ conversationId }: { conversationId: string }) {
  const { versions } = useAppEvents();
  const fetcher = useCallback(() => api.conversationPlan(conversationId), [conversationId]);
  const {
    data,
    loading,
    refreshing,
    error,
    refetch,
    replaceData,
  } = useApi(fetcher, conversationId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<ChecklistDraftItem[]>([]);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [composerText, setComposerText] = useState('');
  const [composerMenuIndex, setComposerMenuIndex] = useState(0);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void refetch({ resetLoading: false });
  }, [conversationId, refetch, versions.sessions]);

  useEffect(() => {
    setActionError(null);
    setDraggingItemId(null);
    setPendingAction(null);
    setDraftKey(null);
    setDraftItems([]);
    setComposerText('');
    setComposerMenuIndex(0);
  }, [conversationId]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const nextKey = JSON.stringify(data.automation.items.map((item) => ({
      id: item.id,
      text: toChecklistDraftItems([item])[0]?.text ?? '',
      status: item.status,
      updatedAt: item.updatedAt,
    })));

    if (nextKey === draftKey) {
      return;
    }

    setDraftItems(toChecklistDraftItems(data.automation.items));
    setDraftKey(nextKey);
  }, [data, draftKey]);

  useEffect(() => {
    if (!composerTextareaRef.current) {
      return;
    }

    const element = composerTextareaRef.current;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 128)}px`;
  }, [composerText]);

  const automation = data?.automation ?? null;
  const presets = useMemo(
    () => data?.presetLibrary.presets ?? [],
    [data?.presetLibrary.presets],
  );
  const composerMenuItems = useMemo(
    () => buildComposerMenuItems(composerText, data?.skills ?? [], presets),
    [composerText, data?.skills, presets],
  );
  const showComposerMenu = composerText.trim().startsWith('/') && composerMenuItems.length > 0;

  if (loading && !data) {
    return <LoadingState label="Loading todo list…" className="px-3 py-3" />;
  }

  if (error && !data) {
    return <ErrorState message={error} className="px-3 py-3" />;
  }

  if (!data || !automation) {
    return null;
  }

  const progressLabel = buildProgressLabel(automation);

  async function persistItems(nextItems: ChecklistDraftItem[]) {
    const saved = await api.updateConversationPlan(conversationId, {
      items: checklistDraftItemsToTemplateItems(nextItems),
    });
    replaceData(saved);
    setDraftItems(toChecklistDraftItems(saved.automation.items));
    setDraftKey(JSON.stringify(saved.automation.items.map((item) => ({
      id: item.id,
      text: toChecklistDraftItems([item])[0]?.text ?? '',
      status: item.status,
      updatedAt: item.updatedAt,
    }))));
  }

  async function handleCommitItems(nextItems: ChecklistDraftItem[]) {
    setActionError(null);
    setPendingAction('save');
    try {
      await persistItems(nextItems);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleToggle(itemId: string, checked: boolean) {
    setActionError(null);
    setPendingAction('toggle');
    try {
      const saved = await api.setConversationPlanItemStatus(conversationId, itemId, checked);
      replaceData(saved);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  function applyComposerMenuItem(item: TodoComposerMenuItem) {
    setComposerText(item.insertText);
    setComposerMenuIndex(0);
    requestAnimationFrame(() => composerTextareaRef.current?.focus());
  }

  async function handleAddComposerItem() {
    const trimmed = composerText.trim();
    if (!trimmed || pendingAction !== null) {
      return;
    }

    const presetShortcut = resolvePresetShortcut(trimmed, presets);
    if (presetShortcut.kind === 'missing') {
      setActionError('Choose a preset to add.');
      return;
    }
    if (presetShortcut.kind === 'missingPreset') {
      setActionError(`No preset named “${presetShortcut.query}”.`);
      return;
    }

    const nextItems = presetShortcut.kind === 'preset'
      ? appendChecklistPresetItems(draftItems, presetShortcut.preset)
      : [...draftItems, createChecklistDraftItem(trimmed)];

    setActionError(null);
    setComposerText('');
    setComposerMenuIndex(0);
    setDraftItems(nextItems);
    await handleCommitItems(nextItems);
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
    <SurfacePanel muted className="overflow-hidden px-0 py-0">
      <div className="flex items-start justify-between gap-3 px-3 py-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-primary">Todo list</p>
          <p className="mt-1 text-[11px] text-dim">
            {automation.items.length} {automation.items.length === 1 ? 'item' : 'items'}
            <span className="mx-1.5 opacity-40">·</span>
            {progressLabel}
            {refreshing && <span className="ml-1.5">· refreshing…</span>}
          </p>
        </div>
        <Link to="/plans" className="ui-toolbar-button inline-flex shrink-0 items-center gap-1 text-[11px] text-accent" title="Edit presets">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18" />
            <path d="M7 12h10" />
            <path d="M10 18h4" />
          </svg>
          <span>Edit presets</span>
        </Link>
      </div>

      {automation.waitingForUser && (
        <p className="border-t border-border-subtle/70 px-3 py-3 text-[11px] text-warning">
          Waiting for you{automation.waitingForUser.reason ? `: ${automation.waitingForUser.reason}` : '.'}
        </p>
      )}

      <div className="border-t border-border-subtle/70">
        {draftItems.length === 0 ? (
          <div className="px-3 py-4 text-[12px] text-dim">Nothing here yet. Add the next step below.</div>
        ) : draftItems.map((draftItem) => {
          const runtimeItem = automation.items.find((item) => item.id === draftItem.id) ?? null;
          const checked = runtimeItem?.status === 'completed';
          const active = automation.activeItemId === draftItem.id;
          const locked = runtimeItem?.status === 'running' && active;
          const supportText = runtimeItem ? buildItemSupportText(runtimeItem, active) : null;
          const rows = Math.min(6, Math.max(1, draftItem.text.split('\n').length || 1));

          return (
            <div
              key={draftItem.id}
              className={cx(
                'group grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-2.5',
                'border-b border-border-subtle/70 last:border-b-0',
                draggingItemId === draftItem.id && 'opacity-60',
                active && 'bg-accent/[0.05]',
              )}
              onDragOver={(event) => {
                if (!draggingItemId || draggingItemId === draftItem.id || locked) {
                  return;
                }
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!draggingItemId || draggingItemId === draftItem.id || locked) {
                  return;
                }
                const nextItems = moveDraftItem(draftItems, draggingItemId, draftItem.id);
                setDraftItems(nextItems);
                setDraggingItemId(null);
                void handleCommitItems(nextItems);
              }}
            >
              <button
                type="button"
                draggable={!locked && pendingAction === null}
                onDragStart={() => setDraggingItemId(draftItem.id)}
                onDragEnd={() => setDraggingItemId(null)}
                className="mt-1 inline-flex h-5 w-4 items-center justify-center text-dim/55 opacity-0 transition hover:text-secondary focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-20"
                title="Drag to reorder"
                disabled={locked || pendingAction !== null}
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

              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => { void handleToggle(draftItem.id, !checked); }}
                disabled={locked || pendingAction !== null}
                className={cx(
                  'mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                  checked
                    ? 'border-accent bg-accent text-white'
                    : 'border-border-default text-transparent hover:border-accent/55',
                  locked || pendingAction !== null ? 'opacity-50' : '',
                )}
                title={checked ? 'Mark incomplete' : 'Mark complete'}
                aria-label={checked ? 'Mark incomplete' : 'Mark complete'}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 12 5 5L20 7" />
                </svg>
              </button>

              <div className="min-w-0">
                <textarea
                  value={draftItem.text}
                  rows={rows}
                  onChange={(event) => {
                    const nextText = event.target.value;
                    setDraftItems((current) => current.map((item) => item.id === draftItem.id ? { ...item, text: nextText } : item));
                  }}
                  onBlur={() => { void handleCommitItems(draftItems); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      (event.currentTarget as HTMLTextAreaElement).blur();
                    }
                  }}
                  placeholder="Type anything the agent should do. You can use /skill:..., slash commands, or plain text."
                  className={cx(
                    ITEM_TEXTAREA_CLASS,
                    checked && 'text-dim line-through decoration-border-default/70',
                  )}
                  disabled={locked || pendingAction === 'toggle'}
                />
                {supportText && <p className="mt-0.5 text-[11px] text-dim break-words">{supportText}</p>}
              </div>

              <IconButton
                compact
                onClick={() => {
                  const nextItems = draftItems.filter((item) => item.id !== draftItem.id);
                  setDraftItems(nextItems);
                  void handleCommitItems(nextItems);
                }}
                disabled={locked || pendingAction !== null}
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

        {automation.review && (
          <div className="px-3 py-2.5 text-[11px] text-dim">
            Review pass · {automation.review.status} · round {automation.review.round}
            {automation.review.resultReason ? ` · ${automation.review.resultReason}` : ''}
          </div>
        )}
      </div>

      <div className="border-t border-border-subtle/70 px-3 py-2.5">
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
                  if (actionError) {
                    setActionError(null);
                  }
                }}
                onKeyDown={handleComposerKeyDown}
                rows={1}
                disabled={pendingAction !== null}
                className={COMPOSER_TEXTAREA_CLASS}
                placeholder="Add an item… /skill:... or /preset:..."
                title="Type / to insert a skill or preset"
                style={{ minHeight: '20px', maxHeight: '96px' }}
              />

              <button
                type="button"
                onClick={() => { void handleAddComposerItem(); }}
                disabled={pendingAction !== null || composerText.trim().length === 0}
                className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/75 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </div>

      {actionError && <p className="px-3 pb-3 text-[11px] text-danger">{actionError}</p>}
    </SurfacePanel>
  );
}
