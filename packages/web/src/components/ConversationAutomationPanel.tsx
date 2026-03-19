import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import type {
  ConversationAutomationResponse,
  ConversationAutomationTemplateTodoItem,
  ConversationAutomationTodoItem,
} from '../types';
import { ErrorState, LoadingState, Pill, SurfacePanel, ToolbarButton, cx } from './ui';

const SELECT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';

function itemTone(status: ConversationAutomationTodoItem['status']) {
  switch (status) {
    case 'running':
      return 'accent' as const;
    case 'completed':
      return 'success' as const;
    case 'blocked':
      return 'warning' as const;
    case 'failed':
      return 'danger' as const;
    default:
      return 'muted' as const;
  }
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

  const blocked = automation.items.find((item) => item.status === 'blocked');
  if (blocked) {
    return `${completed}/${automation.items.length} complete · blocked ${blocked.label}`;
  }

  if (automation.review?.status === 'running') {
    return `${completed}/${automation.items.length} complete · reviewing`;
  }

  if (completed === automation.items.length) {
    return 'All complete';
  }

  return `${completed}/${automation.items.length} complete`;
}

function cloneTemplateItem(item: ConversationAutomationTemplateTodoItem): ConversationAutomationTemplateTodoItem {
  return item.kind === 'instruction'
    ? {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'instruction',
      label: item.label,
      text: item.text,
    }
    : {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'skill',
      label: item.label,
      skillName: item.skillName,
      ...(item.skillArgs ? { skillArgs: item.skillArgs } : {}),
    };
}

function templateItemFromRuntimeItem(item: ConversationAutomationTodoItem): ConversationAutomationTemplateTodoItem {
  return item.kind === 'instruction'
    ? {
      id: item.id,
      kind: 'instruction',
      label: item.label,
      text: item.text,
    }
    : {
      id: item.id,
      kind: 'skill',
      label: item.label,
      skillName: item.skillName,
      ...(item.skillArgs ? { skillArgs: item.skillArgs } : {}),
    };
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
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedTemplateItemKey, setSelectedTemplateItemKey] = useState('');
  const [pendingAction, setPendingAction] = useState<'item' | 'plan' | null>(null);

  useEffect(() => {
    void refetch({ resetLoading: false });
  }, [conversationId, refetch, versions.sessions]);

  useEffect(() => {
    setActionError(null);
    setSelectedPlanId('');
    setSelectedTemplateItemKey('');
    setPendingAction(null);
  }, [conversationId]);

  if (loading && !data) {
    return <LoadingState label="Loading plan…" className="px-3 py-3" />;
  }

  if (error && !data) {
    return <ErrorState message={error} className="px-3 py-3" />;
  }

  if (!data) {
    return null;
  }

  const automation = data.automation;
  const presetLibrary = data.presetLibrary;
  const progressLabel = buildProgressLabel(automation);
  const planOptions = presetLibrary.presets;
  const itemOptions = useMemo(() => presetLibrary.presets.flatMap((preset) => preset.items.map((item) => ({
    key: `${preset.id}::${item.id}`,
    presetId: preset.id,
    presetName: preset.name,
    item,
  }))), [presetLibrary.presets]);

  useEffect(() => {
    if (!selectedPlanId || planOptions.some((preset) => preset.id === selectedPlanId)) {
      return;
    }
    setSelectedPlanId(planOptions[0]?.id ?? '');
  }, [planOptions, selectedPlanId]);

  useEffect(() => {
    if (!selectedTemplateItemKey || itemOptions.some((item) => item.key === selectedTemplateItemKey)) {
      return;
    }
    setSelectedTemplateItemKey(itemOptions[0]?.key ?? '');
  }, [itemOptions, selectedTemplateItemKey]);

  async function saveItems(nextItems: ConversationAutomationTemplateTodoItem[]) {
    const saved = await api.updateConversationPlan(conversationId, { items: nextItems });
    replaceData(saved);
  }

  async function handleAddPlan() {
    if (!selectedPlanId || pendingAction) {
      return;
    }

    const preset = planOptions.find((candidate) => candidate.id === selectedPlanId);
    if (!preset) {
      return;
    }

    setActionError(null);
    setPendingAction('plan');
    try {
      await saveItems([
        ...automation.items.map(templateItemFromRuntimeItem),
        ...preset.items.map(cloneTemplateItem),
      ]);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleAddItem() {
    if (!selectedTemplateItemKey || pendingAction) {
      return;
    }

    const selected = itemOptions.find((item) => item.key === selectedTemplateItemKey);
    if (!selected) {
      return;
    }

    setActionError(null);
    setPendingAction('item');
    try {
      await saveItems([
        ...automation.items.map(templateItemFromRuntimeItem),
        cloneTemplateItem(selected.item),
      ]);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <SurfacePanel muted className="space-y-3 px-3 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-dim">
          {automation.items.length} {automation.items.length === 1 ? 'item' : 'items'}
        </span>
        <span className="text-[11px] text-dim">{progressLabel}</span>
        {refreshing && <span className="text-[11px] text-dim">refreshing…</span>}
      </div>

      {!data.live && automation.items.length > 0 && (
        <p className="text-[11px] text-warning">Resume conversation to start working through these items.</p>
      )}

      {(itemOptions.length > 0 || planOptions.length > 0) && (
        <div className="space-y-2 border-t border-border-subtle pt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="ui-section-label">Add items</p>
            <Link to="/plans" className="text-[11px] text-accent hover:underline">manage plans</Link>
          </div>

          {itemOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={selectedTemplateItemKey}
                onChange={(event) => setSelectedTemplateItemKey(event.target.value)}
                className={cx(SELECT_CLASS, 'flex-1')}
                disabled={pendingAction !== null}
              >
                {itemOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.presetName} · {option.item.label}
                  </option>
                ))}
              </select>
              <ToolbarButton
                onClick={() => { void handleAddItem(); }}
                disabled={!selectedTemplateItemKey || pendingAction !== null}
                className="text-accent"
              >
                {pendingAction === 'item' ? 'Adding…' : 'Add item'}
              </ToolbarButton>
            </div>
          )}

          {planOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={selectedPlanId}
                onChange={(event) => setSelectedPlanId(event.target.value)}
                className={cx(SELECT_CLASS, 'flex-1')}
                disabled={pendingAction !== null}
              >
                {planOptions.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} · {preset.items.length} {preset.items.length === 1 ? 'item' : 'items'}
                  </option>
                ))}
              </select>
              <ToolbarButton
                onClick={() => { void handleAddPlan(); }}
                disabled={!selectedPlanId || pendingAction !== null}
                className="text-accent"
              >
                {pendingAction === 'plan' ? 'Adding…' : 'Add plan'}
              </ToolbarButton>
            </div>
          )}
        </div>
      )}

      {automation.items.length === 0 ? (
        <div className="border-t border-border-subtle pt-3 text-[12px] text-dim">
          No todo list yet. Add items from a plan to get started.
        </div>
      ) : (
        <div className="space-y-2 border-t border-border-subtle pt-3">
          <p className="ui-section-label">Todo list</p>
          {automation.items.map((item, index) => (
            <div key={item.id} className="rounded-lg bg-surface/60 px-3 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-[0.14em] text-dim">Item {index + 1}</span>
                <Pill tone={itemTone(item.status)}>{item.status}</Pill>
                {automation.activeItemId === item.id && <span className="text-[10px] uppercase tracking-[0.14em] text-accent">active</span>}
              </div>
              <p className="mt-1 text-[13px] font-medium text-primary break-words">{item.label}</p>
              <p className="mt-1 rounded-md bg-base/60 px-2.5 py-2 text-[11px] leading-relaxed break-words text-secondary font-mono whitespace-pre-wrap">
                {item.kind === 'instruction'
                  ? item.text
                  : `/skill:${item.skillName}${item.skillArgs ? ` ${item.skillArgs}` : ''}`}
              </p>
              {item.resultReason && <p className="mt-1 text-[11px] text-secondary break-words">{item.resultReason}</p>}
            </div>
          ))}

          {automation.review && (
            <div className="rounded-lg bg-base/40 px-3 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-[0.14em] text-dim">Review</span>
                <Pill tone={automation.review.status === 'completed' ? 'success' : automation.review.status === 'failed' ? 'danger' : 'accent'}>
                  {automation.review.status}
                </Pill>
                <span className="text-[10px] text-dim">round {automation.review.round}</span>
              </div>
              {automation.review.resultReason && <p className="mt-1 text-[11px] text-secondary break-words">{automation.review.resultReason}</p>}
            </div>
          )}
        </div>
      )}

      {actionError && <p className="text-[11px] text-danger">{actionError}</p>}
    </SurfacePanel>
  );
}
