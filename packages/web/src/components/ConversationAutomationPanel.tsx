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
import { ErrorState, ListButtonRow, LoadingState, SurfacePanel, ToolbarButton, cx } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[88px] resize-y leading-relaxed`;

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
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarButton onClick={() => setAppendOpen((value) => !value)} disabled={pendingAction !== null}>Append checklist</ToolbarButton>
          <ToolbarButton onClick={() => setDraftItems((current) => [...current, createChecklistDraftItem()])} disabled={pendingAction !== null}>+ Add item</ToolbarButton>
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

          return (
            <div
              key={draftItem.id}
              className={cx('grid gap-3 px-3 py-3 lg:grid-cols-[auto_auto_minmax(0,1fr)_auto] lg:items-start', draggingItemId === draftItem.id && 'opacity-60')}
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
                className="mt-2 flex h-8 w-8 items-center justify-center rounded-lg border border-border-default bg-base text-[12px] text-dim disabled:opacity-40"
                title="Drag to reorder"
                disabled={locked || pendingAction !== null}
              >
                ⋮⋮
              </button>

              <label className="mt-2 flex h-8 w-8 items-center justify-center rounded-lg border border-border-default bg-base">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-accent)]"
                  checked={checked}
                  disabled={locked || pendingAction !== null}
                  onChange={(event) => { void handleToggle(draftItem.id, event.target.checked); }}
                />
              </label>

              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-dim">Item {index + 1}</span>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-dim">{runtimeItem ? itemMeta(runtimeItem, active) : summarizeChecklistText(draftItem.text)}</span>
                </div>
                <textarea
                  value={draftItem.text}
                  onChange={(event) => setDraftItems((current) => current.map((item) => item.id === draftItem.id ? { ...item, text: event.target.value } : item))}
                  onBlur={() => { void handleCommitItems(draftItems); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      (event.currentTarget as HTMLTextAreaElement).blur();
                    }
                  }}
                  placeholder="Type anything the agent should do. You can use /skill:..., slash commands, or plain text."
                  className={TEXTAREA_CLASS}
                  disabled={locked || pendingAction === 'toggle'}
                />
                {runtimeItem?.resultReason && <p className="text-[11px] text-secondary break-words">{runtimeItem.resultReason}</p>}
              </div>

              <div className="flex items-center gap-1 justify-self-start lg:justify-self-end lg:pt-2">
                <ToolbarButton
                  onClick={() => {
                    const nextItems = draftItems.filter((item) => item.id !== draftItem.id);
                    setDraftItems(nextItems);
                    void handleCommitItems(nextItems);
                  }}
                  disabled={locked || pendingAction !== null}
                  className="text-danger"
                >
                  Remove
                </ToolbarButton>
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
