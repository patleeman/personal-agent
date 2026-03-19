import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import type {
  ConversationAutomationResponse,
  ConversationAutomationTemplateGate,
  ConversationAutomationTemplateSkillStep,
  ConversationAutomationWorkflowPreset,
  SessionMeta,
} from '../types';
import { timeAgo } from '../utils';
import {
  EmptyState,
  ErrorState,
  ListLinkRow,
  LoadingState,
  PageHeader,
  PageHeading,
  Pill,
  ToolbarButton,
  cx,
} from '../components/ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[144px] resize-y leading-relaxed`;
const CHECKBOX_CLASS = 'h-4 w-4 rounded border-border-default bg-base text-accent focus:ring-0 focus:outline-none';

type EditorSelection =
  | { kind: 'gate'; gateId: string }
  | { kind: 'skill'; gateId: string; skillId: string }
  | null;

function createDraftId(prefix: 'gate' | 'skill' | 'preset'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneTemplateSkill(skill: ConversationAutomationTemplateSkillStep): ConversationAutomationTemplateSkillStep {
  return {
    id: skill.id,
    label: skill.label,
    skillName: skill.skillName,
    ...(skill.skillArgs ? { skillArgs: skill.skillArgs } : {}),
  };
}

function cloneTemplateGate(gate: ConversationAutomationTemplateGate): ConversationAutomationTemplateGate {
  return {
    id: gate.id,
    label: gate.label,
    prompt: gate.prompt,
    skills: gate.skills.map(cloneTemplateSkill),
  };
}

function clonePreset(preset: ConversationAutomationWorkflowPreset): ConversationAutomationWorkflowPreset {
  return {
    id: preset.id,
    name: preset.name,
    updatedAt: preset.updatedAt,
    gates: preset.gates.map(cloneTemplateGate),
  };
}

function buildTemplateFromRuntime(gates: ConversationAutomationResponse['automation']['gates']): ConversationAutomationTemplateGate[] {
  return gates.map((gate) => ({
    id: gate.id,
    label: gate.label,
    prompt: gate.prompt,
    skills: gate.skills.map((skill) => ({
      id: skill.id,
      label: skill.label,
      skillName: skill.skillName,
      ...(skill.skillArgs ? { skillArgs: skill.skillArgs } : {}),
    })),
  }));
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

function createEmptyGate(): ConversationAutomationTemplateGate {
  return {
    id: createDraftId('gate'),
    label: 'Judge gate',
    prompt: 'Decide whether the nested skills should run now.',
    skills: [],
  };
}

function createEmptySkill(skills: ConversationAutomationResponse['skills']): ConversationAutomationTemplateSkillStep {
  const firstSkillName = skills[0]?.name ?? '';
  return {
    id: createDraftId('skill'),
    label: firstSkillName || 'Skill step',
    skillName: firstSkillName,
  };
}

function moveItem<T>(items: T[], index: number, direction: 'up' | 'down'): T[] {
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= items.length) {
    return items;
  }

  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(targetIndex, 0, item as T);
  return next;
}

function recentSessions(sessions: SessionMeta[] | null): SessionMeta[] {
  return [...(sessions ?? [])].sort((left, right) => (
    new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
  ));
}

function Workspace({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const { sessions } = useAppData();
  const { versions } = useAppEvents();
  const fetcher = useCallback(() => api.conversationAutomation(conversationId), [conversationId]);
  const {
    data,
    loading,
    refreshing,
    error,
    refetch,
  } = useApi(fetcher, conversationId);
  const [initialized, setInitialized] = useState(false);
  const [draftGates, setDraftGates] = useState<ConversationAutomationTemplateGate[]>([]);
  const [draftBaselineJson, setDraftBaselineJson] = useState('[]');
  const [selection, setSelection] = useState<EditorSelection>(null);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [presetAction, setPresetAction] = useState<'saveNew' | 'update' | 'delete' | 'default' | null>(null);
  const [togglingEnabled, setTogglingEnabled] = useState(false);

  useEffect(() => {
    void refetch({ resetLoading: false });
  }, [conversationId, refetch, versions.sessions]);

  useEffect(() => {
    setInitialized(false);
    setDraftGates([]);
    setDraftBaselineJson('[]');
    setSelection(null);
    setSelectedPresetId('');
    setPresetNameDraft('');
    setActionError(null);
    setSavingWorkflow(false);
    setPresetAction(null);
    setTogglingEnabled(false);
  }, [conversationId]);

  const automation = data?.automation ?? {
    conversationId,
    enabled: false,
    activeGateId: null,
    activeSkillId: null,
    updatedAt: '',
    gates: [],
  };
  const presetLibrary = data?.presetLibrary ?? { presets: [], defaultPresetId: null };
  const defaultPreset = useMemo(
    () => presetLibrary.defaultPresetId
      ? presetLibrary.presets.find((preset) => preset.id === presetLibrary.defaultPresetId) ?? null
      : null,
    [presetLibrary.defaultPresetId, presetLibrary.presets],
  );
  const inheritedPreset = useMemo(
    () => data?.inheritedPresetId
      ? presetLibrary.presets.find((preset) => preset.id === data.inheritedPresetId) ?? null
      : null,
    [data?.inheritedPresetId, presetLibrary.presets],
  );
  const selectedPreset = useMemo(
    () => presetLibrary.presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presetLibrary.presets, selectedPresetId],
  );
  const progressLabel = buildProgressLabel(automation);
  const totalSkillCount = countSkills(automation.gates);
  const editorDirty = JSON.stringify(draftGates) !== draftBaselineJson;
  const conversationTitle = sessions?.find((session) => session.id === conversationId)?.title ?? conversationId;

  const selectedGate = useMemo(() => {
    if (selection?.kind === 'gate') {
      return draftGates.find((gate) => gate.id === selection.gateId) ?? null;
    }
    if (selection?.kind === 'skill') {
      return draftGates.find((gate) => gate.id === selection.gateId) ?? null;
    }
    return null;
  }, [draftGates, selection]);

  const selectedSkill = useMemo(() => {
    if (selection?.kind !== 'skill') {
      return null;
    }
    return selectedGate?.skills.find((skill) => skill.id === selection.skillId) ?? null;
  }, [selectedGate, selection]);

  useEffect(() => {
    if (!data || initialized) {
      return;
    }

    const nextDraft = buildTemplateFromRuntime(data.automation.gates);
    setDraftGates(nextDraft);
    setDraftBaselineJson(JSON.stringify(nextDraft));
    setSelection(nextDraft[0] ? { kind: 'gate', gateId: nextDraft[0].id } : null);

    const fallbackPresetId = data.inheritedPresetId ?? data.presetLibrary.defaultPresetId ?? data.presetLibrary.presets[0]?.id ?? '';
    const fallbackPreset = data.presetLibrary.presets.find((preset) => preset.id === fallbackPresetId) ?? null;
    setSelectedPresetId(fallbackPresetId);
    setPresetNameDraft(fallbackPreset?.name ?? '');
    setInitialized(true);
  }, [data, initialized]);

  useEffect(() => {
    if (!data) {
      return;
    }

    if (selectedPresetId && presetLibrary.presets.some((preset) => preset.id === selectedPresetId)) {
      return;
    }

    const fallbackPresetId = data.inheritedPresetId ?? presetLibrary.defaultPresetId ?? presetLibrary.presets[0]?.id ?? '';
    const fallbackPreset = presetLibrary.presets.find((preset) => preset.id === fallbackPresetId) ?? null;
    setSelectedPresetId(fallbackPresetId);
    if (!presetNameDraft.trim()) {
      setPresetNameDraft(fallbackPreset?.name ?? '');
    }
  }, [data, presetLibrary.defaultPresetId, presetLibrary.presets, presetNameDraft, selectedPresetId]);

  async function refreshWithResult<T>(request: Promise<T>) {
    setActionError(null);
    await request;
    return refetch({ resetLoading: false });
  }

  function syncPresetEditorState(nextData: ConversationAutomationResponse, preferredPresetId?: string | null) {
    const presets = nextData.presetLibrary.presets;
    const nextPresetId = preferredPresetId && presets.some((preset) => preset.id === preferredPresetId)
      ? preferredPresetId
      : nextData.presetLibrary.defaultPresetId && presets.some((preset) => preset.id === nextData.presetLibrary.defaultPresetId)
        ? nextData.presetLibrary.defaultPresetId
        : presets[0]?.id ?? '';
    const nextPreset = presets.find((preset) => preset.id === nextPresetId) ?? null;
    setSelectedPresetId(nextPresetId);
    setPresetNameDraft(nextPreset?.name ?? '');
  }

  function resetEditorFromData(nextData: ConversationAutomationResponse) {
    const nextDraft = buildTemplateFromRuntime(nextData.automation.gates);
    setDraftGates(nextDraft);
    setDraftBaselineJson(JSON.stringify(nextDraft));
    if (nextDraft.length === 0) {
      setSelection(null);
      return;
    }
    setSelection((current) => {
      if (current?.kind === 'gate' && nextDraft.some((gate) => gate.id === current.gateId)) {
        return current;
      }
      if (current?.kind === 'skill') {
        const gate = nextDraft.find((candidate) => candidate.id === current.gateId);
        if (gate?.skills.some((skill) => skill.id === current.skillId)) {
          return current;
        }
      }
      return { kind: 'gate', gateId: nextDraft[0]!.id };
    });
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

  function updateDraftGates(updater: (current: ConversationAutomationTemplateGate[]) => ConversationAutomationTemplateGate[]) {
    setDraftGates((current) => updater(current).map(cloneTemplateGate));
  }

  function handleAddGate() {
    const gate = createEmptyGate();
    updateDraftGates((current) => [...current, gate]);
    setSelection({ kind: 'gate', gateId: gate.id });
  }

  function handleAddSkill(gateId: string) {
    if (!data || data.skills.length === 0) {
      return;
    }

    const skill = createEmptySkill(data.skills);
    updateDraftGates((current) => current.map((gate) => gate.id === gateId
      ? { ...gate, skills: [...gate.skills, skill] }
      : gate));
    setSelection({ kind: 'skill', gateId, skillId: skill.id });
  }

  function handleDeleteGate(gateId: string) {
    updateDraftGates((current) => current.filter((gate) => gate.id !== gateId));
    setSelection((current) => current && current.gateId === gateId ? null : current);
  }

  function handleDeleteSkill(gateId: string, skillId: string) {
    updateDraftGates((current) => current.map((gate) => gate.id === gateId
      ? { ...gate, skills: gate.skills.filter((skill) => skill.id !== skillId) }
      : gate));
    setSelection((current) => current?.kind === 'skill' && current.skillId === skillId ? { kind: 'gate', gateId } : current);
  }

  function handleMoveGate(gateId: string, direction: 'up' | 'down') {
    updateDraftGates((current) => {
      const index = current.findIndex((gate) => gate.id === gateId);
      return index < 0 ? current : moveItem(current, index, direction);
    });
  }

  function handleMoveSkill(gateId: string, skillId: string, direction: 'up' | 'down') {
    updateDraftGates((current) => current.map((gate) => {
      if (gate.id !== gateId) {
        return gate;
      }
      const index = gate.skills.findIndex((skill) => skill.id === skillId);
      return index < 0 ? gate : { ...gate, skills: moveItem(gate.skills, index, direction) };
    }));
  }

  function handleUpdateSelectedGate(patch: Partial<ConversationAutomationTemplateGate>) {
    if (!selectedGate) {
      return;
    }

    updateDraftGates((current) => current.map((gate) => gate.id === selectedGate.id ? { ...gate, ...patch } : gate));
  }

  function handleUpdateSelectedSkill(patch: Partial<ConversationAutomationTemplateSkillStep>) {
    if (!selectedGate || !selectedSkill) {
      return;
    }

    updateDraftGates((current) => current.map((gate) => {
      if (gate.id !== selectedGate.id) {
        return gate;
      }
      return {
        ...gate,
        skills: gate.skills.map((skill) => skill.id === selectedSkill.id ? { ...skill, ...patch } : skill),
      };
    }));
  }

  async function handleSaveWorkflow() {
    if (!data || savingWorkflow) {
      return;
    }

    setSavingWorkflow(true);
    try {
      const nextData = await refreshWithResult(api.updateConversationAutomation(conversationId, {
        gates: draftGates,
      }));
      if (nextData) {
        resetEditorFromData(nextData);
      }
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSavingWorkflow(false);
    }
  }

  async function savePresetLibrary(
    nextPresets: ConversationAutomationWorkflowPreset[],
    nextDefaultPresetId: string | null,
    action: 'saveNew' | 'update' | 'delete' | 'default',
    preferredPresetId?: string | null,
  ) {
    setPresetAction(action);
    try {
      const nextData = await refreshWithResult(api.updateConversationAutomationWorkflowPresets({
        presets: nextPresets.map(clonePreset),
        defaultPresetId: nextDefaultPresetId,
      }));
      if (nextData) {
        syncPresetEditorState(nextData, preferredPresetId ?? nextDefaultPresetId);
      }
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPresetAction(null);
    }
  }

  async function handleSavePresetAsNew() {
    const name = presetNameDraft.trim();
    if (!data || presetAction || !name || draftGates.length === 0) {
      return;
    }

    const presetId = createDraftId('preset');
    await savePresetLibrary([
      ...presetLibrary.presets,
      {
        id: presetId,
        name,
        updatedAt: new Date().toISOString(),
        gates: draftGates.map(cloneTemplateGate),
      },
    ], presetLibrary.defaultPresetId, 'saveNew', presetId);
  }

  async function handleUpdateSelectedPreset() {
    const name = presetNameDraft.trim();
    if (!selectedPreset || presetAction || !name || draftGates.length === 0) {
      return;
    }

    await savePresetLibrary(
      presetLibrary.presets.map((preset) => preset.id === selectedPreset.id
        ? {
          ...preset,
          name,
          gates: draftGates.map(cloneTemplateGate),
        }
        : clonePreset(preset)),
      presetLibrary.defaultPresetId,
      'update',
      selectedPreset.id,
    );
  }

  async function handleDeleteSelectedPreset() {
    if (!selectedPreset || presetAction) {
      return;
    }

    const nextPresets = presetLibrary.presets.filter((preset) => preset.id !== selectedPreset.id);
    const nextDefaultPresetId = presetLibrary.defaultPresetId === selectedPreset.id
      ? null
      : presetLibrary.defaultPresetId;
    await savePresetLibrary(nextPresets, nextDefaultPresetId, 'delete', nextDefaultPresetId ?? nextPresets[0]?.id ?? null);
  }

  async function handleSetSelectedPresetAsDefault(nextDefaultPresetId: string | null) {
    if (presetAction) {
      return;
    }

    await savePresetLibrary(presetLibrary.presets, nextDefaultPresetId, 'default', nextDefaultPresetId);
  }

  function handleLoadSelectedPreset() {
    if (!selectedPreset) {
      return;
    }

    const nextDraft = selectedPreset.gates.map(cloneTemplateGate);
    setDraftGates(nextDraft);
    setSelection(nextDraft[0] ? { kind: 'gate', gateId: nextDraft[0].id } : null);
  }

  if (loading && !data) {
    return (
      <div className="px-6 py-4">
        <LoadingState label="Loading automation…" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="px-6 py-4">
        <ErrorState message={`Failed to load automation: ${error}`} />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const selectedSkillInfo = selectedSkill
    ? data.skills.find((skill) => skill.name === selectedSkill.skillName) ?? null
    : null;

  const pageMeta = [
    conversationTitle,
    automation.enabled ? 'automation on' : 'automation off',
    `${automation.gates.length} ${automation.gates.length === 1 ? 'gate' : 'gates'}`,
    `${totalSkillCount} ${totalSkillCount === 1 ? 'skill' : 'skills'}`,
  ].join(' · ');

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={(
          <>
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
            <ToolbarButton onClick={() => { navigate(`/conversations/${encodeURIComponent(conversationId)}`); }}>
              Open conversation
            </ToolbarButton>
          </>
        )}
      >
        <PageHeading title="Automation" meta={pageMeta} />
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill tone={automation.enabled ? 'accent' : 'muted'}>{automation.enabled ? 'on' : 'off'}</Pill>
              {inheritedPreset && <Pill tone="steel">preset · {inheritedPreset.name}</Pill>}
              {defaultPreset && <Pill tone="steel">default · {defaultPreset.name}</Pill>}
              {refreshing && <span className="text-[11px] text-dim">refreshing…</span>}
              {editorDirty && <Pill tone="warning">unsaved</Pill>}
            </div>
            <p className="text-[12px] leading-relaxed text-secondary">
              Gates fire only after <span className="font-mono">turn_end</span>. Failed gates wait for the next turn and evaluate again. When a gate passes, its nested skills run in order immediately in this same conversation.
            </p>
            <p className="text-[11px] text-dim">{progressLabel}</p>
            {!data.live && automation.enabled && (
              <p className="text-[11px] text-warning">Resume this conversation to continue evaluating gates and running nested skills.</p>
            )}
          </div>

          <div className="grid min-h-[calc(100vh-14rem)] gap-6 md:grid-cols-[24rem_minmax(0,1fr)]">
            <div className="min-h-0 overflow-y-auto border-b border-border-subtle pb-6 md:border-b-0 md:border-r md:pr-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="ui-section-label">Preset library</p>
                  <select
                    value={selectedPresetId}
                    onChange={(event) => {
                      const nextPresetId = event.target.value;
                      setSelectedPresetId(nextPresetId);
                      const nextPreset = presetLibrary.presets.find((preset) => preset.id === nextPresetId) ?? null;
                      setPresetNameDraft(nextPreset?.name ?? '');
                    }}
                    className={INPUT_CLASS}
                  >
                    <option value="">No preset selected</option>
                    {presetLibrary.presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}{presetLibrary.defaultPresetId === preset.id ? ' · default' : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    value={presetNameDraft}
                    onChange={(event) => setPresetNameDraft(event.target.value)}
                    className={INPUT_CLASS}
                    placeholder="Preset name"
                  />
                  <div className="flex flex-wrap gap-2">
                    <ToolbarButton onClick={handleLoadSelectedPreset} disabled={!selectedPreset}>
                      load preset
                    </ToolbarButton>
                    <ToolbarButton onClick={() => { void handleSavePresetAsNew(); }} disabled={presetAction !== null || draftGates.length === 0 || presetNameDraft.trim().length === 0}>
                      {presetAction === 'saveNew' ? 'Saving…' : 'Save new preset'}
                    </ToolbarButton>
                    <ToolbarButton onClick={() => { void handleUpdateSelectedPreset(); }} disabled={presetAction !== null || !selectedPreset || draftGates.length === 0 || presetNameDraft.trim().length === 0}>
                      {presetAction === 'update' ? 'Saving…' : 'Update preset'}
                    </ToolbarButton>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ToolbarButton
                      onClick={() => { void handleSetSelectedPresetAsDefault(selectedPreset?.id ?? null); }}
                      disabled={presetAction !== null || !selectedPreset || presetLibrary.defaultPresetId === selectedPreset.id}
                    >
                      {presetAction === 'default' ? 'Saving…' : 'Set default'}
                    </ToolbarButton>
                    <ToolbarButton
                      onClick={() => { void handleSetSelectedPresetAsDefault(null); }}
                      disabled={presetAction !== null || !presetLibrary.defaultPresetId}
                      className="text-danger"
                    >
                      {presetAction === 'default' ? 'Saving…' : 'Clear default'}
                    </ToolbarButton>
                    <ToolbarButton onClick={() => { void handleDeleteSelectedPreset(); }} disabled={presetAction !== null || !selectedPreset} className="text-danger">
                      {presetAction === 'delete' ? 'Deleting…' : 'Delete preset'}
                    </ToolbarButton>
                  </div>
                  <p className="text-[11px] text-dim">The default preset seeds new conversations until you save a local workflow.</p>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-3">
                  <ToolbarButton onClick={handleAddGate} className="text-accent">+ gate</ToolbarButton>
                  <ToolbarButton onClick={() => { setDraftGates([]); setSelection(null); }} disabled={draftGates.length === 0} className="text-danger">
                    clear draft
                  </ToolbarButton>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-3">
                  <ToolbarButton onClick={() => { void handleSaveWorkflow(); }} disabled={savingWorkflow || !editorDirty} className="text-accent">
                    {savingWorkflow ? 'Saving…' : 'Save workflow'}
                  </ToolbarButton>
                  <Link to="/settings" className="ui-toolbar-button">Judge defaults</Link>
                </div>
              </div>

              {draftGates.length === 0 ? (
                <EmptyState
                  className="px-1 py-8"
                  title="No gates in this draft"
                  body="Add a gate, or load one of your saved presets and then save it into this conversation."
                />
              ) : (
                <div className="mt-4 border-t border-border-subtle">
                  {draftGates.map((gate, gateIndex) => (
                    <div key={gate.id} className={cx('border-t border-border-subtle first:border-t-0', selection?.gateId === gate.id && 'bg-accent/8')}>
                      <div className="space-y-2 px-1 py-3">
                        <div className="flex items-start gap-2">
                          <button type="button" onClick={() => setSelection({ kind: 'gate', gateId: gate.id })} className="min-w-0 flex-1 text-left">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] uppercase tracking-[0.14em] text-dim">gate {gateIndex + 1}</span>
                            </div>
                            <p className="mt-1 text-[13px] font-medium text-primary break-words">{gate.label}</p>
                            <p className="mt-1 text-[11px] text-secondary">Evaluates on turn_end · {gate.skills.length} nested {gate.skills.length === 1 ? 'skill' : 'skills'}</p>
                          </button>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <ToolbarButton onClick={() => handleMoveGate(gate.id, 'up')} disabled={gateIndex === 0}>↑</ToolbarButton>
                            <ToolbarButton onClick={() => handleMoveGate(gate.id, 'down')} disabled={gateIndex === draftGates.length - 1}>↓</ToolbarButton>
                            <ToolbarButton onClick={() => handleAddSkill(gate.id)} disabled={data.skills.length === 0}>+ skill</ToolbarButton>
                            <ToolbarButton onClick={() => handleDeleteGate(gate.id)} className="text-danger">del</ToolbarButton>
                          </div>
                        </div>

                        <div className="space-y-1 pl-3">
                          {gate.skills.length === 0 ? (
                            <p className="text-[11px] text-dim">No nested skills yet.</p>
                          ) : gate.skills.map((skill, skillIndex) => (
                            <div key={skill.id} className={cx('flex items-center gap-2 rounded-lg px-2 py-1', selection?.kind === 'skill' && selection.skillId === skill.id && 'bg-accent/8')}>
                              <button type="button" onClick={() => setSelection({ kind: 'skill', gateId: gate.id, skillId: skill.id })} className="min-w-0 flex-1 text-left">
                                <p className="truncate text-[12px] text-primary">↳ {skill.label}</p>
                                <p className="truncate text-[10px] text-dim">{skill.skillArgs ? `/skill:${skill.skillName} ${skill.skillArgs}` : `/skill:${skill.skillName}`}</p>
                              </button>
                              <ToolbarButton onClick={() => handleMoveSkill(gate.id, skill.id, 'up')} disabled={skillIndex === 0}>↑</ToolbarButton>
                              <ToolbarButton onClick={() => handleMoveSkill(gate.id, skill.id, 'down')} disabled={skillIndex === gate.skills.length - 1}>↓</ToolbarButton>
                              <ToolbarButton onClick={() => handleDeleteSkill(gate.id, skill.id)} className="text-danger">del</ToolbarButton>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="min-h-0 overflow-y-auto pb-6 md:pl-2">
              {!selection || !selectedGate ? (
                <EmptyState
                  className="mt-6"
                  title="Pick a gate or skill"
                  body="Select a gate block on the left to edit its judge prompt, or select a nested skill to edit the follow-up that runs after the gate passes."
                />
              ) : selection.kind === 'gate' ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="ui-section-label">Edit gate</p>
                    <p className="text-[12px] text-secondary">This judge prompt is evaluated only on turn_end. If it returns pass, the nested skills underneath it run in order.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="ui-section-label" htmlFor="automation-gate-label">Label</label>
                    <input
                      id="automation-gate-label"
                      value={selectedGate.label}
                      onChange={(event) => handleUpdateSelectedGate({ label: event.target.value })}
                      className={INPUT_CLASS}
                      placeholder="Gate label"
                      disabled={savingWorkflow}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="ui-section-label" htmlFor="automation-gate-prompt">Judge prompt</label>
                    <textarea
                      id="automation-gate-prompt"
                      value={selectedGate.prompt}
                      onChange={(event) => handleUpdateSelectedGate({ prompt: event.target.value })}
                      className={TEXTAREA_CLASS}
                      placeholder="Decide whether the nested skills should run now."
                      disabled={savingWorkflow}
                    />
                    <p className="text-[11px] text-dim">Judge input is sanitized to visible user/assistant messages only. Tool calls, tool output, and thinking are removed before evaluation.</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <ToolbarButton onClick={() => handleAddSkill(selectedGate.id)} disabled={data.skills.length === 0} className="text-accent">+ nested skill</ToolbarButton>
                    <ToolbarButton onClick={() => setSelection(null)}>Done</ToolbarButton>
                  </div>
                </div>
              ) : selectedSkill ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="ui-section-label">Edit nested skill</p>
                    <p className="text-[12px] text-secondary">This follow-up runs only after the parent gate passes. Skills run in their listed order inside each gate.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="ui-section-label" htmlFor="automation-skill-label">Label</label>
                    <input
                      id="automation-skill-label"
                      value={selectedSkill.label}
                      onChange={(event) => handleUpdateSelectedSkill({ label: event.target.value })}
                      className={INPUT_CLASS}
                      placeholder="Skill label"
                      disabled={savingWorkflow}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="ui-section-label" htmlFor="automation-skill-name">Skill</label>
                    <select
                      id="automation-skill-name"
                      value={selectedSkill.skillName}
                      onChange={(event) => {
                        const skillName = event.target.value;
                        const selectedMeta = data.skills.find((skill) => skill.name === skillName);
                        handleUpdateSelectedSkill({
                          skillName,
                          label: selectedMeta?.name ?? selectedSkill.label,
                        });
                      }}
                      className={INPUT_CLASS}
                      disabled={savingWorkflow || data.skills.length === 0}
                    >
                      {data.skills.map((skill) => (
                        <option key={skill.name} value={skill.name}>{skill.name} · {skill.source}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-dim break-words">{selectedSkillInfo?.description ?? 'No description available.'}</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="ui-section-label" htmlFor="automation-skill-args">Args</label>
                    <input
                      id="automation-skill-args"
                      value={selectedSkill.skillArgs ?? ''}
                      onChange={(event) => handleUpdateSelectedSkill({ skillArgs: event.target.value })}
                      className={INPUT_CLASS}
                      placeholder="Optional one-line args appended after /skill:name"
                      disabled={savingWorkflow}
                    />
                    <p className="text-[11px] text-dim">{selectedSkill.skillArgs ? `/skill:${selectedSkill.skillName} ${selectedSkill.skillArgs}` : `/skill:${selectedSkill.skillName}`}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <ToolbarButton onClick={() => setSelection({ kind: 'gate', gateId: selectedGate.id })}>Back to gate</ToolbarButton>
                  </div>
                </div>
              ) : null}

              {actionError && <p className="mt-4 text-[11px] text-danger">{actionError}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AutomationPage() {
  const { id: conversationId } = useParams<{ id?: string }>();
  const { sessions } = useAppData();
  const items = useMemo(() => recentSessions(sessions).slice(0, 24), [sessions]);

  if (conversationId) {
    return <Workspace conversationId={conversationId} />;
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <PageHeading
          title="Automation"
          meta={sessions ? `${sessions.length} ${sessions.length === 1 ? 'conversation' : 'conversations'} available` : 'Choose a conversation to edit its workflow'}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {sessions === null ? (
          <LoadingState label="Loading conversations…" />
        ) : items.length === 0 ? (
          <EmptyState
            title="No conversations available"
            body="Open or create a conversation, then come back here to edit its automation workflow."
          />
        ) : (
          <div className="space-y-px">
            {items.map((session) => (
              <ListLinkRow
                key={session.id}
                to={`/automation/${encodeURIComponent(session.id)}`}
                leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${session.isRunning ? 'bg-accent' : 'bg-border-default/60'}`} />}
              >
                <p className="ui-row-title truncate">{session.title}</p>
                <p className="ui-row-summary break-words">{session.cwd}</p>
                <p className="ui-row-meta flex flex-wrap items-center gap-1.5">
                  <span>{timeAgo(session.timestamp)}</span>
                  {session.isRunning && (
                    <>
                      <span className="opacity-40">·</span>
                      <span className="text-accent">running</span>
                    </>
                  )}
                </p>
              </ListLinkRow>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
