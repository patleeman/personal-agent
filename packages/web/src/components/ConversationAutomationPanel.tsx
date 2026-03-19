import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import type {
  ConversationAutomationGate,
  ConversationAutomationResponse,
  ConversationAutomationSkillStep,
  ConversationAutomationTemplateGate,
} from '../types';
import { ErrorState, LoadingState, Pill, SurfacePanel, ToolbarButton, cx } from './ui';

const SELECT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';

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
    return 'No gates';
  }

  const completed = automation.gates.filter((gate) => gate.status === 'completed').length;
  const running = automation.gates.find((gate) => gate.status === 'running');
  if (running) {
    return `${completed}/${automation.gates.length} complete · running ${running.label}`;
  }

  if (completed === automation.gates.length) {
    return 'All complete';
  }

  return `${completed}/${automation.gates.length} complete`;
}

function gateMeta(gate: ConversationAutomationGate): string {
  if (gate.status === 'running') {
    return 'Evaluating now';
  }
  if (gate.status === 'completed') {
    return 'Passed';
  }
  if (gate.status === 'failed') {
    return 'Will retry next turn';
  }
  return 'Waiting';
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

    const presetGates = clonePresetGatesForConversation(selectedPreset.gates);
    const nextGates = [
      ...automation.gates.map((gate) => ({
        id: gate.id,
        label: gate.label,
        prompt: gate.prompt,
        skills: gate.skills.map((skill) => ({
          id: skill.id,
          label: skill.label,
          skillName: skill.skillName,
          ...(skill.skillArgs ? { skillArgs: skill.skillArgs } : {}),
        })),
      })),
      ...presetGates,
    ];

    setActionError(null);
    setApplyingPreset(true);
    try {
      const saved = await api.updateConversationAutomation(conversationId, {
        gates: nextGates,
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
  const totalSkillCount = countSkills(automation.gates);
  const canToggleEnabled = !(automation.gates.length === 0 && defaultPresets.length === 0 && !automation.enabled);

  return (
    <SurfacePanel muted className="space-y-3 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-dim">
              {automation.gates.length} {automation.gates.length === 1 ? 'gate' : 'gates'} · {totalSkillCount} {totalSkillCount === 1 ? 'skill' : 'skills'}
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
              {presetLibrary.presets.map((preset) => {
                const skillCount = countSkills(preset.gates);
                return (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} · {preset.gates.length} {preset.gates.length === 1 ? 'gate' : 'gates'} · {skillCount} {skillCount === 1 ? 'skill' : 'skills'}
                  </option>
                );
              })}
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

      {automation.gates.length === 0 ? (
        <div className="border-t border-border-subtle pt-3 text-[12px] text-dim">
          {defaultPresets.length > 0
            ? `Using defaults: ${defaultPresets.map((preset) => preset.name).join(', ')}`
            : 'No workflow yet. Add a preset or manage presets.'}
        </div>
      ) : (
        <div className="space-y-2 border-t border-border-subtle pt-3">
          <p className="ui-section-label">Pipeline</p>
          {automation.gates.map((gate, index) => (
            <div
              key={gate.id}
              className={cx(
                'rounded-lg px-3 py-3 transition-colors',
                gate.matchesCurrentConditions ? 'bg-success/10 ring-1 ring-success/20' : 'bg-surface/60',
              )}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-dim">Gate {index + 1}</span>
                  <Pill tone={gateTone(gate.status)}>{gate.status}</Pill>
                  {automation.activeGateId === gate.id && <span className="text-[10px] uppercase tracking-[0.14em] text-accent">active</span>}
                </div>
                <p className="text-[13px] font-medium text-primary break-words">{gate.label}</p>
                <p className={cx(
                  'rounded-md px-2.5 py-2 font-mono text-[11px] leading-relaxed break-words',
                  gate.matchesCurrentConditions ? 'bg-success/10 text-success' : 'bg-base/60 text-secondary',
                )}>
                  {gate.prompt}
                </p>
                <p className="text-[11px] text-dim">
                  {gateMeta(gate)}
                  {typeof gate.resultConfidence === 'number' ? ` · ${Math.round(gate.resultConfidence * 100)}%` : ''}
                </p>
                {gate.resultReason && <p className="text-[11px] text-secondary break-words">{gate.resultReason}</p>}
              </div>

              <div className="mt-2 space-y-1.5">
                {gate.skills.length === 0 ? (
                  <p className="text-[11px] text-dim">No skills.</p>
                ) : gate.skills.map((skill) => (
                  <div key={skill.id} className="flex items-center justify-between gap-2 rounded-lg bg-base/60 px-2.5 py-2">
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
          ))}
        </div>
      )}

      <p className="text-[11px] text-dim">Judge model · {data.judge.effectiveModel}</p>

      {actionError && <p className="text-[11px] text-danger">{actionError}</p>}
    </SurfacePanel>
  );
}
