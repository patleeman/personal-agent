import { useCallback, useEffect, useState } from 'react';
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

  if (automation.review?.status === 'running') {
    return `${completed}/${automation.items.length} complete · reviewing`;
  }

  if (completed === automation.items.length) {
    return 'All complete';
  }

  return `${completed}/${automation.items.length} complete`;
}

function clonePresetItemsForConversation(items: ConversationAutomationTemplateTodoItem[]): ConversationAutomationTemplateTodoItem[] {
  return items.map((item) => ({
    ...item,
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }));
}

export function ConversationAutomationPanel({ conversationId }: { conversationId: string }) {
  const { versions } = useAppEvents();
  const fetcher = useCallback(() => api.conversationAutomation(conversationId), [conversationId]);
  const {
    data,
    loading,
    refreshing,
    error,
    refetch,
    replaceData,
  } = useApi(fetcher, conversationId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [selectedApplyPresetId, setSelectedApplyPresetId] = useState('');
  const [applyingPreset, setApplyingPreset] = useState(false);

  useEffect(() => {
    void refetch({ resetLoading: false });
  }, [conversationId, refetch, versions.sessions]);

  useEffect(() => {
    setActionError(null);
    setTogglingEnabled(false);
    setSelectedApplyPresetId('');
    setApplyingPreset(false);
  }, [conversationId]);

  async function handleToggleEnabled(nextEnabled: boolean) {
    if (!data || togglingEnabled) {
      return;
    }

    setActionError(null);
    setTogglingEnabled(true);
    try {
      const saved = await api.updateConversationAutomation(conversationId, {
        enabled: nextEnabled,
      });
      replaceData(saved);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setTogglingEnabled(false);
    }
  }

  async function handleApplyPreset() {
    if (!data || !selectedApplyPresetId || applyingPreset) {
      return;
    }

    const selectedPreset = data.presetLibrary.presets.find((preset) => preset.id === selectedApplyPresetId);
    if (!selectedPreset) {
      return;
    }

    const nextItems = [
      ...automation.items.map((item) => ({
        id: item.id,
        label: item.label,
        skillName: item.skillName,
        ...(item.skillArgs ? { skillArgs: item.skillArgs } : {}),
      })),
      ...clonePresetItemsForConversation(selectedPreset.items),
    ];

    setActionError(null);
    setApplyingPreset(true);
    try {
      const saved = await api.updateConversationAutomation(conversationId, {
        items: nextItems,
      });
      replaceData(saved);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setApplyingPreset(false);
    }
  }

  useEffect(() => {
    if (!data) {
      return;
    }

    const selectedStillExists = selectedApplyPresetId
      && data.presetLibrary.presets.some((preset) => preset.id === selectedApplyPresetId);
    if (selectedStillExists) {
      return;
    }

    const fallbackId = [...data.inheritedPresetIds, ...data.presetLibrary.defaultPresetIds]
      .find((presetId) => presetId.trim().length > 0 && data.presetLibrary.presets.some((preset) => preset.id === presetId))
      ?? data.presetLibrary.presets[0]?.id
      ?? '';

    if (fallbackId !== selectedApplyPresetId) {
      setSelectedApplyPresetId(fallbackId);
    }
  }, [data, selectedApplyPresetId]);

  if (loading && !data) {
    return <LoadingState label="Loading automation…" className="px-3 py-3" />;
  }

  if (error && !data) {
    return <ErrorState message={error} className="px-3 py-3" />;
  }

  if (!data) {
    return null;
  }

  const automation = data.automation;
  const presetLibrary = data.presetLibrary;
  const defaultPresets = presetLibrary.defaultPresetIds
    .map((presetId) => presetLibrary.presets.find((preset) => preset.id === presetId) ?? null)
    .filter((preset): preset is NonNullable<typeof preset> => Boolean(preset));
  const inheritedPresets = data.inheritedPresetIds
    .map((presetId) => presetLibrary.presets.find((preset) => preset.id === presetId) ?? null)
    .filter((preset): preset is NonNullable<typeof preset> => Boolean(preset));
  const progressLabel = buildProgressLabel(automation);
  const canToggleEnabled = !(automation.items.length === 0 && defaultPresets.length === 0 && !automation.enabled);

  return (
    <SurfacePanel muted className="space-y-3 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-dim">
              {automation.items.length} {automation.items.length === 1 ? 'item' : 'items'}
            </span>
            <span className="text-[11px] text-dim">{progressLabel}</span>
            {refreshing && <span className="text-[11px] text-dim">refreshing…</span>}
          </div>
          {(inheritedPresets.length > 0 || defaultPresets.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {inheritedPresets.map((preset) => <Pill key={`inherited-${preset.id}`} tone="steel">{preset.name}</Pill>)}
              {inheritedPresets.length === 0 && defaultPresets.map((preset) => <Pill key={`default-${preset.id}`} tone="steel">{preset.name}</Pill>)}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => { void handleToggleEnabled(!automation.enabled); }}
          disabled={togglingEnabled || !canToggleEnabled}
          className={cx(
            'inline-flex items-center gap-2 rounded-full px-1 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            automation.enabled ? 'bg-success/15 text-success' : 'bg-surface text-dim',
          )}
          aria-pressed={automation.enabled}
        >
          <span
            className={cx(
              'relative inline-flex h-5 w-9 rounded-full transition-colors',
              automation.enabled ? 'bg-success' : 'bg-border-default',
            )}
          >
            <span
              className={cx(
                'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                automation.enabled ? 'translate-x-[18px]' : 'translate-x-0.5',
              )}
            />
          </span>
          <span className="pr-2 font-medium">{togglingEnabled ? 'Saving…' : 'Enabled'}</span>
        </button>
      </div>

      {!data.live && automation.enabled && (
        <p className="text-[11px] text-warning">Resume conversation to keep automation running.</p>
      )}

      {presetLibrary.presets.length > 0 && (
        <div className="space-y-2 border-t border-border-subtle pt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="ui-section-label">Apply presets</p>
            <Link to="/automation" className="text-[11px] text-accent hover:underline">manage</Link>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedApplyPresetId}
              onChange={(event) => setSelectedApplyPresetId(event.target.value)}
              className={cx(SELECT_CLASS, 'flex-1')}
              disabled={applyingPreset}
            >
              {presetLibrary.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} · {preset.items.length} {preset.items.length === 1 ? 'item' : 'items'}
                </option>
              ))}
            </select>
            <ToolbarButton
              onClick={() => { void handleApplyPreset(); }}
              disabled={!selectedApplyPresetId || applyingPreset}
              className="text-accent"
            >
              {applyingPreset ? 'Adding…' : 'Add'}
            </ToolbarButton>
          </div>
        </div>
      )}

      {automation.items.length === 0 ? (
        <div className="border-t border-border-subtle pt-3 text-[12px] text-dim">
          {defaultPresets.length > 0
            ? `Using defaults: ${defaultPresets.map((preset) => preset.name).join(', ')}`
            : 'No todo list yet. Add a preset or manage presets.'}
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
              <p className="mt-1 rounded-md bg-base/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed break-words text-secondary">
                /skill:{item.skillName}{item.skillArgs ? ` ${item.skillArgs}` : ''}
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
