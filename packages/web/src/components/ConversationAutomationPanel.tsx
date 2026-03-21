import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import {
  checklistDraftItemsToTemplateItems,
  type ChecklistDraftItem,
  toChecklistDraftItems,
} from '../checklists';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import type {
  ConversationAutomationResponse,
  ConversationAutomationTodoItem,
} from '../types';
import { ChecklistComposer, ChecklistItemList } from './ChecklistEditor';
import { ErrorState, LoadingState, SurfacePanel } from './ui';

type PendingAction = 'save' | 'toggle' | null;

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
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  useEffect(() => {
    void refetch({ resetLoading: false });
  }, [conversationId, refetch, versions.sessions]);

  useEffect(() => {
    setActionError(null);
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
  const presets = useMemo(
    () => data?.presetLibrary.presets ?? [],
    [data?.presetLibrary.presets],
  );

  const itemStates = useMemo(() => {
    if (!automation) {
      return {};
    }

    return Object.fromEntries(draftItems.map((draftItem) => {
      const runtimeItem = automation.items.find((item) => item.id === draftItem.id) ?? null;
      const checked = runtimeItem?.status === 'completed';
      const active = automation.activeItemId === draftItem.id;
      const locked = runtimeItem?.status === 'running' && active;
      const supportText = runtimeItem ? buildItemSupportText(runtimeItem, active) : null;
      return [draftItem.id, {
        checked,
        active,
        locked,
        supportText,
      }];
    }));
  }, [automation, draftItems]);

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
        <ChecklistItemList
          items={draftItems}
          itemStates={itemStates}
          showCheckboxes
          textDisabled={pendingAction === 'toggle'}
          structureDisabled={pendingAction !== null}
          onChange={setDraftItems}
          onCommit={handleCommitItems}
          onToggleChecked={handleToggle}
        />

        {automation.review && (
          <div className="px-3 py-2.5 text-[11px] text-dim">
            Review pass · {automation.review.status} · round {automation.review.round}
            {automation.review.resultReason ? ` · ${automation.review.resultReason}` : ''}
          </div>
        )}
      </div>

      <div className="border-t border-border-subtle/70 px-3 py-2.5">
        <ChecklistComposer
          currentItems={draftItems}
          skills={data.skills}
          presets={presets}
          disabled={pendingAction !== null}
          onAdd={async (nextItems) => {
            setDraftItems(nextItems);
            await handleCommitItems(nextItems);
          }}
          onErrorChange={setActionError}
        />
      </div>

      {actionError && <p className="px-3 pb-3 text-[11px] text-danger">{actionError}</p>}
    </SurfacePanel>
  );
}
