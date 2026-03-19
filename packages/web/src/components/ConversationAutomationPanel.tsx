import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import type {
  ConversationAutomationGate,
  ConversationAutomationResponse,
  ConversationAutomationSkillStep,
} from '../types';
import { ErrorState, LoadingState, Pill, SurfacePanel, ToolbarButton } from './ui';

const CHECKBOX_CLASS = 'h-4 w-4 rounded border-border-default bg-base text-accent focus:ring-0 focus:outline-none';

function gateTone(status: ConversationAutomationGate['status']) {
  switch (status) {
    case 'running':
      return 'accent' as const;
    case 'completed':
      return 'success' as const;
    case 'failed':
      return 'warning' as const;
    default:
      return 'muted' as const;
  }
}

function skillTone(status: ConversationAutomationSkillStep['status']) {
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

function countSkills(gates: Array<{ skills: unknown[] }>) {
  return gates.reduce((sum, gate) => sum + gate.skills.length, 0);
}

function buildProgressLabel(automation: ConversationAutomationResponse['automation']): string {
  if (automation.gates.length === 0) {
    return 'No gates configured';
  }

  const completed = automation.gates.filter((gate) => gate.status === 'completed').length;
  const running = automation.gates.find((gate) => gate.status === 'running');
  if (running) {
    return `${completed}/${automation.gates.length} gates complete · currently ${running.label}`;
  }

  if (completed === automation.gates.length) {
    return 'All gates completed';
  }

  return `${completed}/${automation.gates.length} gates complete`;
}

function describeGate(gate: ConversationAutomationGate): string {
  if (gate.status === 'failed') {
    return 'Will re-evaluate on the next turn_end while Automation is On.';
  }
  if (gate.status === 'running') {
    return gate.skills.some((skill) => skill.status === 'running')
      ? 'Gate passed. Nested skills are running in order.'
      : 'Gate is currently evaluating the sanitized user/assistant thread.';
  }
  if (gate.status === 'completed') {
    return 'Gate passed and all nested skills finished.';
  }
  return 'Evaluates after each conversation turn while Automation is On.';
}

export function ConversationAutomationPanel({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const { versions } = useAppEvents();
  const fetcher = useCallback(() => api.conversationAutomation(conversationId), [conversationId]);
  const {
    data,
    loading,
    refreshing,
    error,
    refetch,
  } = useApi(fetcher, conversationId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [rerunningGateId, setRerunningGateId] = useState<string | null>(null);

  useEffect(() => {
    void refetch({ resetLoading: false });
  }, [conversationId, refetch, versions.sessions]);

  useEffect(() => {
    setActionError(null);
    setTogglingEnabled(false);
    setRerunningGateId(null);
  }, [conversationId]);

  async function refreshWithResult<T>(request: Promise<T>) {
    setActionError(null);
    await request;
    return refetch({ resetLoading: false });
  }

  async function handleToggleEnabled(nextEnabled: boolean) {
    if (!data || togglingEnabled) {
      return;
    }

    setTogglingEnabled(true);
    try {
      await refreshWithResult(api.updateConversationAutomation(conversationId, {
        enabled: nextEnabled,
      }));
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setTogglingEnabled(false);
    }
  }

  async function handleRerunGate(gateId: string) {
    setRerunningGateId(gateId);
    try {
      await refreshWithResult(api.resetConversationAutomationGate(conversationId, gateId, true));
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setRerunningGateId(null);
    }
  }

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
  const defaultPreset = presetLibrary.defaultPresetId
    ? presetLibrary.presets.find((preset) => preset.id === presetLibrary.defaultPresetId) ?? null
    : null;
  const inheritedPreset = data.inheritedPresetId
    ? presetLibrary.presets.find((preset) => preset.id === data.inheritedPresetId) ?? null
    : null;
  const progressLabel = buildProgressLabel(automation);
  const totalSkillCount = countSkills(automation.gates);
  const statusTone = automation.enabled ? 'accent' : 'muted';

  return (
    <SurfacePanel muted className="space-y-3 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={statusTone}>{automation.enabled ? 'on' : 'off'}</Pill>
            {inheritedPreset && <Pill tone="steel">preset · {inheritedPreset.name}</Pill>}
            <span className="text-[11px] text-dim">
              {automation.gates.length === 1 ? '1 gate' : `${automation.gates.length} gates`} · {totalSkillCount === 1 ? '1 skill' : `${totalSkillCount} skills`}
            </span>
            {refreshing && <span className="text-[11px] text-dim">refreshing…</span>}
          </div>
          <p className="text-[12px] leading-relaxed text-secondary">
            Judge gates re-evaluate after each <span className="font-mono">turn_end</span> while Automation is On. When a gate passes, its nested skills run in order as same-thread follow-ups.
          </p>
          <p className="text-[11px] text-dim">{progressLabel}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <label className="inline-flex items-center gap-2 text-[12px] text-primary">
            <span className="text-dim">Automation</span>
            <input
              type="checkbox"
              checked={automation.enabled}
              onChange={(event) => { void handleToggleEnabled(event.target.checked); }}
              disabled={togglingEnabled || (automation.gates.length === 0 && !defaultPreset && !automation.enabled)}
              className={CHECKBOX_CLASS}
            />
            <span>{togglingEnabled ? 'Saving…' : automation.enabled ? 'On' : 'Off'}</span>
          </label>
          <ToolbarButton
            onClick={() => { navigate(`/automation/${encodeURIComponent(conversationId)}`); }}
            className="text-accent"
          >
            {automation.gates.length === 0 ? 'Set up' : 'Open page'}
          </ToolbarButton>
        </div>
      </div>

      {!data.live && automation.enabled && (
        <p className="text-[11px] text-warning">Resume this conversation to continue evaluating gates and running nested skills.</p>
      )}

      {automation.gates.length === 0 ? (
        <p className="text-[12px] text-dim">
          {defaultPreset
            ? `No local workflow saved yet. This conversation will use the default preset “${defaultPreset.name}” until you customize it.`
            : 'No workflow configured yet. Open the automation page to add gate blocks, nested skills, and reusable presets.'}
        </p>
      ) : (
        <div className="space-y-3">
          {automation.gates.map((gate) => (
            <div key={gate.id} className="rounded-xl border border-border-subtle bg-surface/70 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-dim">gate</span>
                    <Pill tone={gateTone(gate.status)}>{gate.status}</Pill>
                    {automation.activeGateId === gate.id && <span className="text-[10px] uppercase tracking-[0.14em] text-accent">active</span>}
                  </div>
                  <p className="text-[13px] font-medium text-primary break-words">{gate.label}</p>
                  <p className="text-[11px] text-secondary break-words">{describeGate(gate)}</p>
                  {gate.resultReason && (
                    <p className="text-[11px] text-dim break-words">
                      {gate.resultReason}
                      {typeof gate.resultConfidence === 'number' ? ` · confidence ${Math.round(gate.resultConfidence * 100)}%` : ''}
                    </p>
                  )}
                  <div className="space-y-1 pt-1">
                    {gate.skills.length === 0 ? (
                      <p className="text-[11px] text-dim">No nested skills.</p>
                    ) : gate.skills.map((skill) => (
                      <div key={skill.id} className="flex items-center justify-between gap-2 pl-3">
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="text-[10px] text-dim">↳</span>
                          <span className="truncate text-[12px] text-primary">{skill.label}</span>
                          <Pill tone={skillTone(skill.status)}>{skill.status}</Pill>
                        </div>
                        {skill.resultReason && <span className="truncate text-[10px] text-dim">{skill.resultReason}</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <ToolbarButton
                  onClick={() => { void handleRerunGate(gate.id); }}
                  disabled={rerunningGateId === gate.id || gate.status === 'running'}
                  className="text-accent"
                >
                  {rerunningGateId === gate.id ? 'Rerunning…' : 'rerun gate'}
                </ToolbarButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-dim">
        Judge defaults live in <Link to="/settings" className="text-accent hover:underline">Settings</Link> · {data.judge.effectiveModel}
      </p>

      {actionError && <p className="text-[11px] text-danger">{actionError}</p>}
    </SurfacePanel>
  );
}
