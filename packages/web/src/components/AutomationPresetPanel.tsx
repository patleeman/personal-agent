import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import type {
  ConversationAutomationTemplateGate,
  ConversationAutomationTemplateSkillStep,
  ConversationAutomationWorkflowPreset,
} from '../types';
import { EmptyState, ErrorState, LoadingState, Pill, ToolbarButton, cx } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[144px] resize-y leading-relaxed`;

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

function createEmptyGate(): ConversationAutomationTemplateGate {
  return {
    id: createDraftId('gate'),
    label: 'Judge gate',
    prompt: 'Decide whether the nested skills should run now.',
    skills: [],
  };
}

function createEmptySkill(skillNames: string[]): ConversationAutomationTemplateSkillStep {
  const firstSkillName = skillNames[0] ?? '';
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

function buildAutomationSearch(locationSearch: string, presetId: string | null, creatingNew = false): string {
  const params = new URLSearchParams(locationSearch);

  if (presetId) {
    params.set('preset', presetId);
  } else {
    params.delete('preset');
  }

  if (creatingNew) {
    params.set('new', '1');
  } else {
    params.delete('new');
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

export function AutomationPresetPanel({
  presetId,
  creatingNew,
}: {
  presetId: string | null;
  creatingNew: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    data,
    loading,
    refreshing,
    error,
    refetch,
  } = useApi(api.conversationAutomationWorkspace);
  const [initializedKey, setInitializedKey] = useState<string | null>(null);
  const [draftGates, setDraftGates] = useState<ConversationAutomationTemplateGate[]>([]);
  const [draftBaselineJson, setDraftBaselineJson] = useState('[]');
  const [selection, setSelection] = useState<EditorSelection>(null);
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [presetAction, setPresetAction] = useState<'saveNew' | 'update' | 'delete' | 'default' | null>(null);

  const selectedPreset = useMemo(
    () => presetId && data ? data.presetLibrary.presets.find((preset) => preset.id === presetId) ?? null : null,
    [data, presetId],
  );
  const panelKey = creatingNew ? 'new' : selectedPreset?.id ?? null;
  const editorDirty = JSON.stringify(draftGates) !== draftBaselineJson;
  const skillNames = data?.skills.map((skill) => skill.name) ?? [];

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

  const selectedSkillInfo = useMemo(
    () => selectedSkill && data ? data.skills.find((skill) => skill.name === selectedSkill.skillName) ?? null : null,
    [data, selectedSkill],
  );

  useEffect(() => {
    setInitializedKey(null);
    setDraftGates([]);
    setDraftBaselineJson('[]');
    setSelection(null);
    setPresetNameDraft('');
    setActionError(null);
    setPresetAction(null);
  }, [panelKey]);

  useEffect(() => {
    if (!data || !panelKey || initializedKey === panelKey) {
      return;
    }

    const nextDraft = creatingNew || !selectedPreset
      ? []
      : selectedPreset.gates.map(cloneTemplateGate);

    setDraftGates(nextDraft);
    setDraftBaselineJson(JSON.stringify(nextDraft));
    setSelection(nextDraft[0] ? { kind: 'gate', gateId: nextDraft[0].id } : null);
    setPresetNameDraft(creatingNew ? '' : (selectedPreset?.name ?? ''));
    setInitializedKey(panelKey);
  }, [creatingNew, data, initializedKey, panelKey, selectedPreset]);

  function updateDraftGates(updater: (current: ConversationAutomationTemplateGate[]) => ConversationAutomationTemplateGate[]) {
    setDraftGates((current) => updater(current).map(cloneTemplateGate));
  }

  function handleAddGate() {
    const gate = createEmptyGate();
    updateDraftGates((current) => [...current, gate]);
    setSelection({ kind: 'gate', gateId: gate.id });
  }

  function handleAddSkill(gateId: string) {
    if (skillNames.length === 0) {
      return;
    }

    const skill = createEmptySkill(skillNames);
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

  async function savePresetLibrary(
    nextPresets: ConversationAutomationWorkflowPreset[],
    nextDefaultPresetIds: string[],
    action: 'saveNew' | 'update' | 'delete' | 'default',
    nextSelection?: { presetId: string | null; creatingNew?: boolean },
  ) {
    setPresetAction(action);
    setActionError(null);
    try {
      await api.updateConversationAutomationWorkflowPresets({
        presets: nextPresets.map(clonePreset),
        defaultPresetIds: nextDefaultPresetIds,
      });
      await refetch({ resetLoading: false });
      const nextSearch = buildAutomationSearch(location.search, nextSelection?.presetId ?? null, nextSelection?.creatingNew ?? false);
      navigate(`/automation${nextSearch}`, { replace: true });
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPresetAction(null);
    }
  }

  async function handleSavePresetAsNew() {
    if (!data) {
      return;
    }

    const name = presetNameDraft.trim();
    if (!name || draftGates.length === 0 || presetAction !== null) {
      return;
    }

    const nextPresetId = createDraftId('preset');
    await savePresetLibrary([
      ...data.presetLibrary.presets,
      {
        id: nextPresetId,
        name,
        updatedAt: new Date().toISOString(),
        gates: draftGates.map(cloneTemplateGate),
      },
    ], data.presetLibrary.defaultPresetIds, 'saveNew', { presetId: nextPresetId });
  }

  async function handleUpdateSelectedPreset() {
    if (!data || !selectedPreset) {
      return;
    }

    const name = presetNameDraft.trim();
    if (!name || draftGates.length === 0 || presetAction !== null) {
      return;
    }

    await savePresetLibrary(
      data.presetLibrary.presets.map((preset) => preset.id === selectedPreset.id
        ? {
          ...preset,
          name,
          updatedAt: new Date().toISOString(),
          gates: draftGates.map(cloneTemplateGate),
        }
        : clonePreset(preset)),
      data.presetLibrary.defaultPresetIds,
      'update',
      { presetId: selectedPreset.id },
    );
  }

  async function handleDeleteSelectedPreset() {
    if (!data || !selectedPreset || presetAction !== null) {
      return;
    }

    const nextPresets = data.presetLibrary.presets.filter((preset) => preset.id !== selectedPreset.id);
    const nextDefaultPresetIds = data.presetLibrary.defaultPresetIds.filter((presetId) => presetId !== selectedPreset.id);

    await savePresetLibrary(nextPresets, nextDefaultPresetIds, 'delete', { presetId: null, creatingNew: false });
  }

  async function handleToggleDefaultPreset(nextPresetId: string) {
    if (!data || presetAction !== null) {
      return;
    }

    const nextDefaultPresetIds = data.presetLibrary.defaultPresetIds.includes(nextPresetId)
      ? data.presetLibrary.defaultPresetIds.filter((presetId) => presetId !== nextPresetId)
      : [...data.presetLibrary.defaultPresetIds, nextPresetId];

    await savePresetLibrary(data.presetLibrary.presets, nextDefaultPresetIds, 'default', {
      presetId: selectedPreset?.id ?? null,
      creatingNew,
    });
  }

  if (loading && !data) {
    return <LoadingState label="Loading automation presets…" className="justify-center h-full" />;
  }

  if (error && !data) {
    return <ErrorState message={`Failed to load automation presets: ${error}`} className="px-4 py-4" />;
  }

  if (!data) {
    return null;
  }

  if (!creatingNew && !selectedPreset) {
    return <EmptyState className="px-4 py-8" title="Select a preset" body="Pick a reusable automation preset from the list, or create a new one." />;
  }

  const isDefaultPreset = selectedPreset ? data.presetLibrary.defaultPresetIds.includes(selectedPreset.id) : false;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1 border-b border-border-subtle px-4 py-4">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="ui-card-title break-words">{creatingNew ? 'New automation preset' : (selectedPreset?.name ?? 'Automation preset')}</p>
          {creatingNew && <Pill tone="steel">draft</Pill>}
          {isDefaultPreset && <Pill tone="accent">default</Pill>}
          {refreshing && <span className="text-[11px] text-dim">refreshing…</span>}
          {editorDirty && <Pill tone="warning">unsaved</Pill>}
        </div>
        <p className="ui-card-meta break-words">
          Reusable automation templates live here. Add one or more presets to the default stack to seed new conversations, then customize locally only when you need an override.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <label className="ui-section-label" htmlFor="automation-preset-name">Preset name</label>
            <input
              id="automation-preset-name"
              value={presetNameDraft}
              onChange={(event) => setPresetNameDraft(event.target.value)}
              className={INPUT_CLASS}
              placeholder="Preset name"
              disabled={presetAction !== null}
            />
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-4">
            <ToolbarButton onClick={handleAddGate} className="text-accent">+ gate</ToolbarButton>
            <ToolbarButton onClick={() => { setDraftGates([]); setSelection(null); }} disabled={draftGates.length === 0} className="text-danger">
              clear draft
            </ToolbarButton>
          </div>

          <div className="flex flex-wrap gap-2">
            {creatingNew ? (
              <ToolbarButton onClick={() => { void handleSavePresetAsNew(); }} disabled={presetAction !== null || draftGates.length === 0 || presetNameDraft.trim().length === 0} className="text-accent">
                {presetAction === 'saveNew' ? 'Saving…' : 'Save preset'}
              </ToolbarButton>
            ) : (
              <>
                <ToolbarButton onClick={() => { void handleUpdateSelectedPreset(); }} disabled={presetAction !== null || draftGates.length === 0 || presetNameDraft.trim().length === 0 || !editorDirty} className="text-accent">
                  {presetAction === 'update' ? 'Saving…' : 'Save changes'}
                </ToolbarButton>
                <ToolbarButton onClick={() => { if (selectedPreset) { void handleToggleDefaultPreset(selectedPreset.id); } }} disabled={presetAction !== null || !selectedPreset}>
                  {presetAction === 'default' ? 'Saving…' : isDefaultPreset ? 'Remove from defaults' : 'Add to defaults'}
                </ToolbarButton>
                <ToolbarButton onClick={() => { void handleDeleteSelectedPreset(); }} disabled={presetAction !== null} className="text-danger">
                  {presetAction === 'delete' ? 'Deleting…' : 'Delete preset'}
                </ToolbarButton>
              </>
            )}
            <Link to="/settings" className="ui-toolbar-button">Judge defaults</Link>
          </div>

          {draftGates.length === 0 ? (
            <EmptyState title="No gates in this preset" body="Add a gate to start building a reusable automation template." />
          ) : (
            <div className="space-y-2 border-t border-border-subtle pt-4">
              {draftGates.map((gate, gateIndex) => (
                <div key={gate.id} className={cx('rounded-lg border border-border-subtle bg-surface/70 px-3 py-3', selection?.gateId === gate.id && 'border-accent/30 bg-accent/8')}>
                  <div className="flex items-start gap-2">
                    <button type="button" onClick={() => setSelection({ kind: 'gate', gateId: gate.id })} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-[0.14em] text-dim">gate {gateIndex + 1}</span>
                      </div>
                      <p className="mt-1 text-[13px] font-medium text-primary break-words">{gate.label}</p>
                      <p className="mt-1 text-[11px] text-secondary">{gate.skills.length} nested {gate.skills.length === 1 ? 'skill' : 'skills'}</p>
                    </button>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <ToolbarButton onClick={() => handleMoveGate(gate.id, 'up')} disabled={gateIndex === 0}>↑</ToolbarButton>
                      <ToolbarButton onClick={() => handleMoveGate(gate.id, 'down')} disabled={gateIndex === draftGates.length - 1}>↓</ToolbarButton>
                      <ToolbarButton onClick={() => handleAddSkill(gate.id)} disabled={skillNames.length === 0}>+ skill</ToolbarButton>
                      <ToolbarButton onClick={() => handleDeleteGate(gate.id)} className="text-danger">del</ToolbarButton>
                    </div>
                  </div>

                  <div className="mt-2 space-y-1 pl-3">
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
              ))}
            </div>
          )}

          {!selection || !selectedGate ? (
            <EmptyState title="Pick a gate or skill" body="Select a gate or nested skill above to edit it." />
          ) : selection.kind === 'gate' ? (
            <div className="space-y-4 border-t border-border-subtle pt-4">
              <div className="space-y-1">
                <p className="ui-section-label">Edit gate</p>
                <p className="text-[12px] text-secondary">This judge prompt runs on turn_end. If it passes, the nested skills underneath it run in order.</p>
              </div>

              <div className="space-y-1.5">
                <label className="ui-section-label" htmlFor="automation-gate-label">Label</label>
                <input
                  id="automation-gate-label"
                  value={selectedGate.label}
                  onChange={(event) => handleUpdateSelectedGate({ label: event.target.value })}
                  className={INPUT_CLASS}
                  placeholder="Gate label"
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
                />
                <p className="text-[11px] text-dim">Judge input is sanitized to visible user/assistant messages only. Tool calls, tool output, and thinking are removed before evaluation.</p>
              </div>
            </div>
          ) : selectedSkill ? (
            <div className="space-y-4 border-t border-border-subtle pt-4">
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
                  disabled={skillNames.length === 0}
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
                />
                <p className="text-[11px] text-dim">{selectedSkill.skillArgs ? `/skill:${selectedSkill.skillName} ${selectedSkill.skillArgs}` : `/skill:${selectedSkill.skillName}`}</p>
              </div>
            </div>
          ) : null}

          <div className="space-y-1 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Judge defaults</p>
            <p className="ui-card-meta break-words">{data.judge.effectiveModel} · shared across all automation presets.</p>
          </div>

          {actionError && <p className="text-[11px] text-danger">{actionError}</p>}
        </div>
      </div>
    </div>
  );
}
