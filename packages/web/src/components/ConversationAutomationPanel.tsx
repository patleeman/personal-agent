import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import {
  appendChecklistPresetItems,
  checklistDraftItemsToTemplateItems,
  createChecklistDraftItem,
  type ChecklistDraftItem,
  summarizeChecklistText,
  toChecklistDraftItems,
} from '../checklists';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import type {
  ConversationAutomationResponse,
  ConversationAutomationTodoItem,
} from '../types';
import { ErrorState, IconButton, ListButtonRow, LoadingState, SurfacePanel, cx } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const TEXTAREA_CLASS = 'w-full min-h-[32px] resize-none border-0 bg-transparent px-0 py-0 text-[13px] leading-6 text-primary placeholder:text-dim/80 focus:outline-none disabled:opacity-50';

type AddMode = 'item' | 'checklist';

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

function checklistSearchText(preset: ConversationAutomationResponse['presetLibrary']['presets'][number]): string {
  return [preset.name, ...toChecklistDraftItems(preset.items).map((item) => item.text)].join('\n').toLowerCase();
}

function itemMeta(item: ConversationAutomationTodoItem, active: boolean): string {
  if (item.status === 'waiting') {
    return active ? 'waiting · active' : 'waiting';
  }
  return active ? `${item.status} · active` : item.status;
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
  const [appendOpen, setAppendOpen] = useState(false);
  const [appendQuery, setAppendQuery] = useState('');
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'save' | 'toggle' | 'remove' | 'append' | null>(null);

  useEffect(() => {
    void refetch({ resetLoading: false });
  }, [conversationId, refetch, versions.sessions]);

  useEffect(() => {
    setActionError(null);
    setAppendOpen(false);
    setAppendQuery('');
    setDraggingItemId(null);
    setPendingAction(null);
    setDraftKey(null);
    setDraftItems([]);
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

  const automation = data?.automation ?? null;
  const visibleAppendPresets = useMemo(() => {
    const normalized = appendQuery.trim().toLowerCase();
    return (data?.presetLibrary.presets ?? [])
      .filter((preset) => !normalized || checklistSearchText(preset).includes(normalized));
  }, [appendQuery, data?.presetLibrary.presets]);

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
        <Link to="/plans" className="shrink-0 text-[11px] text-accent hover:underline">manage checklists</Link>
      </div>

      {automation.waitingForUser && (
        <p className="border-t border-border-subtle/70 px-3 py-3 text-[11px] text-warning">
          Waiting for you{automation.waitingForUser.reason ? `: ${automation.waitingForUser.reason}` : '.'}
        </p>
      )}

      <div className="space-y-3 border-t border-border-subtle/70 px-3 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
          <button
            type="button"
            onClick={() => setAppendOpen((value) => !value)}
            disabled={pendingAction !== null}
            className="inline-flex items-center gap-1 text-secondary transition-colors hover:text-primary disabled:opacity-40"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            <span>{appendOpen ? 'Hide checklist picker' : 'Append checklist'}</span>
          </button>
          <button
            type="button"
            onClick={() => setDraftItems((current) => [...current, createChecklistDraftItem()])}
            disabled={pendingAction !== null}
            className="inline-flex items-center gap-1 text-secondary transition-colors hover:text-primary disabled:opacity-40"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span>Add item</span>
          </button>
        </div>

        {appendOpen && (
          <div className="space-y-2">
            <input
              value={appendQuery}
              onChange={(event) => setAppendQuery(event.target.value)}
              placeholder="Search checklists"
              className={INPUT_CLASS}
            />
            <div className="space-y-px">
              {visibleAppendPresets.map((preset) => (
                <ListButtonRow
                  key={preset.id}
                  onClick={() => {
                    const nextItems = appendChecklistPresetItems(draftItems, preset);
                    setDraftItems(nextItems);
                    setAppendOpen(false);
                    setAppendQuery('');
                    void handleCommitItems(nextItems);
                  }}
                  className="-mx-0 px-0 py-2"
                  trailing={<span className="text-[11px] text-accent">Append</span>}
                >
                  <p className="ui-row-title truncate">{preset.name}</p>
                  <p className="ui-row-meta">{preset.items.length} {preset.items.length === 1 ? 'item' : 'items'}</p>
                </ListButtonRow>
              ))}
              {visibleAppendPresets.length === 0 && <p className="text-[11px] text-dim">No checklists match that search.</p>}
            </div>
          </div>
        )}
      </div>

      <div className="divide-y divide-border-subtle/70 border-t border-border-subtle/70">
        {draftItems.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-dim">No items yet.</div>
        ) : draftItems.map((draftItem, index) => {
          const runtimeItem = automation.items.find((item) => item.id === draftItem.id) ?? null;
          const checked = runtimeItem?.status === 'completed';
          const active = automation.activeItemId === draftItem.id;
          const locked = runtimeItem?.status === 'running' && active;
          const rowLabel = runtimeItem ? itemMeta(runtimeItem, active) : summarizeChecklistText(draftItem.text);
          const rows = Math.min(8, Math.max(2, draftItem.text.split('\n').length || 2));

          return (
            <div
              key={draftItem.id}
              className={cx('grid gap-x-3 gap-y-2 px-3 py-3 lg:grid-cols-[auto_auto_minmax(0,1fr)_auto] lg:items-start', draggingItemId === draftItem.id && 'opacity-60')}
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
                className="mt-1 inline-flex h-5 w-4 items-center justify-center text-dim/70 transition-colors hover:text-secondary disabled:opacity-30"
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

              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded-sm border-border-default bg-transparent accent-[var(--color-accent)]"
                checked={checked}
                disabled={locked || pendingAction !== null}
                onChange={(event) => { void handleToggle(draftItem.id, event.target.checked); }}
              />

              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-dim">Item {index + 1}</span>
                    <span className="text-[10px] uppercase tracking-[0.14em] text-dim">{rowLabel}</span>
                  </div>
                  <IconButton
                    compact
                    onClick={() => {
                      const nextItems = draftItems.filter((item) => item.id !== draftItem.id);
                      setDraftItems(nextItems);
                      void handleCommitItems(nextItems);
                    }}
                    disabled={locked || pendingAction !== null}
                    className="text-danger/80 hover:text-danger"
                    title="Remove item"
                    aria-label="Remove item"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                  </IconButton>
                </div>
                <textarea
                  value={draftItem.text}
                  rows={rows}
                  onChange={(event) => setDraftItems((current) => current.map((item) => item.id === draftItem.id ? { ...item, text: event.target.value } : item))}
                  onBlur={() => { void handleCommitItems(draftItems); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      (event.currentTarget as HTMLTextAreaElement).blur();
                    }
                  }}
                  placeholder="Type anything the agent should do. You can use /skill:..., slash commands, or plain text."
                  className={cx(TEXTAREA_CLASS, 'mt-1')}
                  disabled={locked || pendingAction === 'toggle'}
                />
                {runtimeItem?.resultReason && <p className="mt-1 text-[11px] text-secondary break-words">{runtimeItem.resultReason}</p>}
              </div>
            </div>
          );
        })}

        {automation.review && (
          <div className="px-3 py-3 text-[11px] text-dim">
            Review pass · {automation.review.status} · round {automation.review.round}
            {automation.review.resultReason ? ` · ${automation.review.resultReason}` : ''}
          </div>
        )}
      </div>

      {actionError && <p className="px-3 py-3 text-[11px] text-danger">{actionError}</p>}
    </SurfacePanel>
  );
}
