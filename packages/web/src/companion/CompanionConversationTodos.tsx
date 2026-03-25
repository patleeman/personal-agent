import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import {
  checklistDraftItemsToTemplateItems,
  type ChecklistDraftItem,
  toChecklistDraftItems,
} from '../checklists';
import { useApi } from '../hooks';
import type {
  ConversationAutomationResponse,
  ConversationAutomationTodoItem,
} from '../types';
import { ChecklistComposer, ChecklistItemList } from '../components/ChecklistEditor';

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

function buildDraftKey(items: ConversationAutomationResponse['automation']['items']): string {
  return JSON.stringify(items.map((item) => ({
    id: item.id,
    text: toChecklistDraftItems([item])[0]?.text ?? '',
    status: item.status,
    updatedAt: item.updatedAt,
  })));
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

export function CompanionConversationTodos({
  conversationId,
  readOnly = false,
  readOnlyReason = null,
}: {
  conversationId: string;
  readOnly?: boolean;
  readOnlyReason?: string | null;
}) {
  const fetchPlan = useCallback(
    () => api.conversationPlan(conversationId),
    [conversationId],
  );
  const {
    data,
    loading,
    refreshing,
    error,
    refetch,
    replaceData,
  } = useApi(fetchPlan, `companion-conversation-plan:${conversationId}`);
  const [draftItems, setDraftItems] = useState<ChecklistDraftItem[]>([]);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  useEffect(() => {
    setDraftItems([]);
    setDraftKey(null);
    setActionError(null);
    setPendingAction(null);
  }, [conversationId]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const nextKey = buildDraftKey(data.automation.items);
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
  const visibleDraftItems = useMemo(() => {
    if (!automation) {
      return draftItems;
    }

    if (draftItems.length > 0 || automation.items.length === 0) {
      return draftItems;
    }

    return toChecklistDraftItems(automation.items);
  }, [automation, draftItems]);
  const itemStates = useMemo(() => {
    if (!automation) {
      return {};
    }

    return Object.fromEntries(visibleDraftItems.map((draftItem) => {
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
  }, [automation, visibleDraftItems]);

  if (loading && !data) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface/70 px-4 py-4">
        <p className="text-[13px] text-dim">Loading todo list…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface/70 px-4 py-4">
        <p className="text-[13px] text-danger">Unable to load the todo list: {error}</p>
      </div>
    );
  }

  if (!data || !automation) {
    return null;
  }

  const progressLabel = buildProgressLabel(automation);
  const editingDisabled = readOnly || pendingAction !== null;

  async function persistItems(nextItems: ChecklistDraftItem[]) {
    const saved = await api.updateConversationPlan(conversationId, {
      items: checklistDraftItemsToTemplateItems(nextItems),
    });
    replaceData(saved);
    setDraftItems(toChecklistDraftItems(saved.automation.items));
    setDraftKey(buildDraftKey(saved.automation.items));
  }

  async function handleCommitItems(nextItems: ChecklistDraftItem[]) {
    if (readOnly) {
      return;
    }

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
    if (readOnly) {
      return;
    }

    setActionError(null);
    setPendingAction('toggle');
    try {
      replaceData(await api.setConversationPlanItemStatus(conversationId, itemId, checked));
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface/70 overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-primary">Todo list</p>
          <p className="mt-1 text-[11px] text-dim">
            {automation.items.length} {automation.items.length === 1 ? 'item' : 'items'}
            <span className="mx-1.5 opacity-40">·</span>
            {progressLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void refetch({ resetLoading: false }); }}
          disabled={refreshing || pendingAction !== null}
          className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {readOnlyReason ? (
        <p className="border-t border-border-subtle/70 px-4 py-3 text-[11px] text-warning">{readOnlyReason}</p>
      ) : null}

      {automation.waitingForUser ? (
        <p className="border-t border-border-subtle/70 px-4 py-3 text-[11px] text-warning">
          Waiting for you{automation.waitingForUser.reason ? `: ${automation.waitingForUser.reason}` : '.'}
        </p>
      ) : null}

      <div className="border-t border-border-subtle/70">
        <ChecklistItemList
          items={visibleDraftItems}
          itemStates={itemStates}
          showCheckboxes
          textDisabled={readOnly || pendingAction === 'toggle'}
          structureDisabled={editingDisabled}
          emptyState="No items yet. Add the next step below."
          onChange={setDraftItems}
          onCommit={handleCommitItems}
          onToggleChecked={handleToggle}
        />
      </div>

      <div className="border-t border-border-subtle/70 px-3 py-3">
        <ChecklistComposer
          currentItems={visibleDraftItems}
          skills={data.skills}
          presets={presets}
          disabled={editingDisabled}
          placeholder={readOnly ? 'Take over to edit the todo list from this device.' : 'Add an item… /skill:... or /preset:...'}
          onAdd={async (nextItems) => {
            setDraftItems(nextItems);
            await handleCommitItems(nextItems);
          }}
          onErrorChange={setActionError}
        />
      </div>

      {actionError ? <p className="px-4 pb-3 text-[11px] text-danger">{actionError}</p> : null}
    </section>
  );
}
