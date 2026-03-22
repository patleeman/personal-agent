import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import {
  checklistDraftItemsToTemplateItems,
  type ChecklistDraftItem,
  toChecklistDraftItems,
} from '../checklists';
import type {
  ConversationAutomationResponse,
  ConversationAutomationStreamEvent,
  ConversationAutomationTodoItem,
} from '../types';
import { ChecklistComposer, ChecklistItemList } from './ChecklistEditor';
import { ErrorState, LoadingState, SurfacePanel } from './ui';

type PendingAction = 'save' | 'toggle' | null;

const conversationAutomationCache = new Map<string, ConversationAutomationResponse>();
const conversationAutomationInflight = new Map<string, Promise<ConversationAutomationResponse>>();

export function prefetchConversationAutomation(
  conversationId: string,
  options?: { force?: boolean },
): Promise<ConversationAutomationResponse> {
  const cached = conversationAutomationCache.get(conversationId);
  if (!options?.force && cached) {
    return Promise.resolve(cached);
  }

  const inflight = conversationAutomationInflight.get(conversationId);
  if (inflight) {
    return inflight;
  }

  const request = api.conversationPlan(conversationId)
    .then((data) => {
      conversationAutomationCache.set(conversationId, data);
      return data;
    })
    .finally(() => {
      conversationAutomationInflight.delete(conversationId);
    });

  conversationAutomationInflight.set(conversationId, request);
  return request;
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

export function ConversationAutomationPanel({ conversationId }: { conversationId: string }) {
  const [data, setData] = useState<ConversationAutomationResponse | null>(() => conversationAutomationCache.get(conversationId) ?? null);
  const [loading, setLoading] = useState(() => !conversationAutomationCache.has(conversationId));
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<ChecklistDraftItem[]>([]);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  useEffect(() => {
    let closed = false;
    let receivedStreamSnapshot = false;
    let stream: EventSource | null = null;

    const cached = conversationAutomationCache.get(conversationId) ?? null;
    setData(cached);
    setLoading(!cached);
    setError(null);

    const applyData = (nextData: ConversationAutomationResponse, source: 'fetch' | 'stream') => {
      if (closed) {
        return;
      }

      if (source === 'stream') {
        receivedStreamSnapshot = true;
      } else if (receivedStreamSnapshot) {
        return;
      }

      conversationAutomationCache.set(conversationId, nextData);
      setData(nextData);
      setLoading(false);
      setError(null);
    };

    void prefetchConversationAutomation(conversationId)
      .then((nextData) => {
        applyData(nextData, 'fetch');
      })
      .catch((nextError) => {
        if (closed || receivedStreamSnapshot) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setLoading(false);
      });

    if (typeof EventSource !== 'undefined') {
      stream = new EventSource(`/api/conversations/${encodeURIComponent(conversationId)}/plan/events`);
      stream.onmessage = (event) => {
        let payload: ConversationAutomationStreamEvent;
        try {
          payload = JSON.parse(event.data) as ConversationAutomationStreamEvent;
        } catch {
          return;
        }

        if (payload.type !== 'snapshot') {
          return;
        }

        applyData(payload.data, 'stream');
      };
    }

    return () => {
      closed = true;
      stream?.close();
    };
  }, [conversationId]);

  useEffect(() => {
    setActionError(null);
    setPendingAction(null);
    setDraftKey(null);
    setDraftItems([]);
    setData(conversationAutomationCache.get(conversationId) ?? null);
    setLoading(!conversationAutomationCache.has(conversationId));
    setError(null);
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
    conversationAutomationCache.set(conversationId, saved);
    conversationAutomationInflight.delete(conversationId);
    setData(saved);
    setDraftItems(toChecklistDraftItems(saved.automation.items));
    setDraftKey(buildDraftKey(saved.automation.items));
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
      conversationAutomationCache.set(conversationId, saved);
      conversationAutomationInflight.delete(conversationId);
      setData(saved);
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
