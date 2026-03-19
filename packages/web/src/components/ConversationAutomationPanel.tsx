import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import type {
  ConversationAutomationGate,
  ConversationAutomationResponse,
  ConversationAutomationSkillStep,
  ConversationAutomationTemplateGate,
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

function createAppliedAutomationId(prefix: 'gate' | 'skill'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clonePresetGatesForConversation(gates: ConversationAutomationTemplateGate[]): ConversationAutomationTemplateGate[] {
  return gates.map((gate) => ({
    ...gate,
    id: createAppliedAutomationId('gate'),
    skills: gate.skills.map((skill) => ({
      ...skill,
      id: createAppliedAutomationId('skill'),
    })),
  }));
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
  const [selectedApplyPresetIds, setSelectedApplyPresetIds] = useState<string[]>([]);
  const [applyingPresetMode, setApplyingPresetMode] = useState<'replace' | 'append' | null>(null);
  const [rerunningGateId, setRerunningGateId] = useState<string | null>(null);

  useEffect(() => {
    void refetch({ resetLoading: false });
  }, [conversationId, refetch, versions.sessions]);

  useEffect(() => {
    setActionError(null);
    setTogglingEnabled(false);
    setSelectedApplyPresetIds([]);
    setApplyingPresetMode(null);
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

  async function handleApplyPresets(mode: 'replace' | 'append') {
    if (!data || selectedApplyPresetIds.length === 0 || applyingPresetMode !== null) {
      return;
    }

    const selectedPresets = data.presetLibrary.presets.filter((preset) => selectedApplyPresetIds.includes(preset.id));
    if (selectedPresets.length === 0) {
      return;
    }

    const presetGates = selectedPresets.flatMap((preset) => clonePresetGatesForConversation(preset.gates));
    const nextGates = mode === 'replace'
      ? presetGates
      : [...automation.gates.map((gate) => ({
          id: gate.id,
          label: gate.label,
          prompt: gate.prompt,
          skills: gate.skills.map((skill) => ({
            id: skill.id,
            label: skill.label,
            skillName: skill.skillName,
            ...(skill.skillArgs ? { skillArgs: skill.skillArgs } : {}),
          })),
        })), ...presetGates];

    setApplyingPresetMode(mode);
    try {
      await refreshWithResult(api.updateConversationAutomation(conversationId, {
        gates: nextGates,
      }));
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setApplyingPresetMode(null);
    }
  }

  useEffect(() => {
    if (!data) {
      return;
    }

    const validIds = selectedApplyPresetIds.filter((presetId) => data.presetLibrary.presets.some((preset) => preset.id === presetId));
    const fallbackIds = [...data.inheritedPresetIds, ...data.presetLibrary.defaultPresetIds]
      .filter((presetId, index, allPresetIds) => presetId.trim().length > 0 && allPresetIds.indexOf(presetId) === index);
    const nextIds = validIds.length > 0 ? validIds : [...new Set(fallbackIds)];

    if (nextIds.length === selectedApplyPresetIds.length && nextIds.every((presetId, index) => presetId === selectedApplyPresetIds[index])) {
      return;
    }

    setSelectedApplyPresetIds(nextIds);
  }, [data, selectedApplyPresetIds]);

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
  const totalSkillCount = countSkills(automation.gates);
  const statusTone = automation.enabled ? 'accent' : 'muted';

  return (
    <SurfacePanel muted className="space-y-3 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={statusTone}>{automation.enabled ? 'on' : 'off'}</Pill>
            {inheritedPresets.map((preset) => <Pill key={preset.id} tone="steel">preset · {preset.name}</Pill>)}
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
              disabled={togglingEnabled || (automation.gates.length === 0 && defaultPresets.length === 0 && !automation.enabled)}
              className={CHECKBOX_CLASS}
            />
            <span>{togglingEnabled ? 'Saving…' : automation.enabled ? 'On' : 'Off'}</span>
          </label>
          <ToolbarButton
            onClick={() => {
              const targetPresetId = inheritedPresets[0]?.id ?? defaultPresets[0]?.id ?? null;
              const params = new URLSearchParams();
              if (targetPresetId) {
                params.set('preset', targetPresetId);
              }
              navigate(`/automation${params.toString() ? `?${params.toString()}` : ''}`);
            }}
            className="text-accent"
          >
            Manage templates
          </ToolbarButton>
        </div>
      </div>

      {!data.live && automation.enabled && (
        <p className="text-[11px] text-warning">Resume this conversation to continue evaluating gates and running nested skills.</p>
      )}

      {presetLibrary.presets.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border-subtle bg-surface/70 px-3 py-3">
          <p className="ui-section-label">Apply reusable presets</p>
          <div className="space-y-2">
            {presetLibrary.presets.map((preset) => {
              const checked = selectedApplyPresetIds.includes(preset.id);
              const skillCount = countSkills(preset.gates);
              return (
                <label key={preset.id} className="flex items-start gap-2 rounded-lg border border-border-subtle px-2.5 py-2 text-[12px] text-primary">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setSelectedApplyPresetIds((current) => event.target.checked
                        ? [...current, preset.id]
                        : current.filter((presetId) => presetId !== preset.id));
                    }}
                    className={CHECKBOX_CLASS}
                    disabled={applyingPresetMode !== null}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-primary">{preset.name}</span>
                      {presetLibrary.defaultPresetIds.includes(preset.id) && <Pill tone="accent">default</Pill>}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-dim">
                      {preset.gates.length} {preset.gates.length === 1 ? 'gate' : 'gates'} · {skillCount} {skillCount === 1 ? 'skill' : 'skills'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <ToolbarButton
              onClick={() => { void handleApplyPresets('replace'); }}
              disabled={selectedApplyPresetIds.length === 0 || applyingPresetMode !== null}
              className="text-accent"
            >
              {applyingPresetMode === 'replace' ? 'Applying…' : 'Replace with selected'}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { void handleApplyPresets('append'); }}
              disabled={selectedApplyPresetIds.length === 0 || applyingPresetMode !== null}
            >
              {applyingPresetMode === 'append' ? 'Applying…' : 'Append selected'}
            </ToolbarButton>
          </div>
          <p className="text-[11px] text-dim">
            Presets are reusable building blocks. Replace the conversation workflow with the selected presets, or append them onto the current workflow in order.
          </p>
        </div>
      )}

      {automation.gates.length === 0 ? (
        <p className="text-[12px] text-dim">
          {defaultPresets.length > 0
            ? `No local workflow saved yet. This conversation will use the default preset stack (${defaultPresets.map((preset) => preset.name).join(', ')}) until you customize it.`
            : 'No workflow configured yet. Use the Automation page to create reusable presets, then add them to the default stack or copy them into this conversation when needed.'}
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
