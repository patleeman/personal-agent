import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApi, usePolling } from '../hooks';
import { timeAgo } from '../utils';
import type { ProjectDetail, ProjectSummary, ProjectTask, ProjectTaskCriterionValidation, ProjectTaskSummary } from '../types';
import {
  EmptyState,
  ErrorState,
  ListLinkRow,
  LoadingState,
  PageHeader,
  PageHeading,
  Pill,
  SectionLabel,
  SurfacePanel,
  ToolbarButton,
} from '../components/ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-sm text-secondary focus:outline-none focus:border-accent/60';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[96px] resize-y whitespace-pre-wrap`;

function projectTone(status: string): 'teal' | 'warning' | 'success' | 'steel' | 'danger' {
  switch (status) {
    case 'blocked':
      return 'warning';
    case 'completed':
      return 'success';
    case 'on-hold':
      return 'steel';
    case 'cancelled':
      return 'danger';
    default:
      return 'teal';
  }
}

function taskTone(status: string): 'muted' | 'teal' | 'warning' | 'success' | 'danger' {
  switch (status) {
    case 'running':
      return 'teal';
    case 'blocked':
      return 'warning';
    case 'done':
      return 'success';
    case 'cancelled':
      return 'danger';
    default:
      return 'muted';
  }
}

function summarizeProject(project: ProjectSummary) {
  const blockers = (project.blockers ?? '').trim();
  if (blockers.length > 0 && blockers.toLowerCase() !== 'none.') {
    return `${project.currentStatus} • Blockers: ${blockers}`;
  }

  return project.currentStatus;
}

function parseLineList(input: string): string[] {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter((line) => line.length > 0);
}

function formatLineList(items?: string[]): string {
  return (items ?? []).join('\n');
}

function formatPlanSteps(steps: ProjectDetail['plan']['steps']): string {
  return steps.map((step) => `${step.completed ? '[x]' : '[ ]'} ${step.text}`).join('\n');
}

function parsePlanSteps(input: string): Array<{ text: string; completed: boolean }> {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = /^\[(x| )\]\s+(.+)$/.exec(line);
      if (match) {
        return { text: match[2].trim(), completed: match[1] === 'x' };
      }

      return { text: line.replace(/^[-*]\s*/, '').trim(), completed: false };
    })
    .filter((step) => step.text.length > 0);
}

function formatCriteriaValidation(items?: ProjectTaskCriterionValidation[]): string {
  return (items ?? [])
    .map((item) => `${item.status} | ${item.criterion}${item.evidence ? ` | ${item.evidence}` : ''}`)
    .join('\n');
}

function parseCriteriaValidation(input: string): ProjectTaskCriterionValidation[] {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const [statusRaw, criterionRaw, evidenceRaw] = line.split('|').map((part) => part.trim());
      const status = statusRaw === 'pass' || statusRaw === 'fail' || statusRaw === 'pending'
        ? statusRaw
        : 'pending';
      const criterion = criterionRaw ?? '';
      if (!criterion) {
        return [];
      }

      return [{ criterion, status, evidence: evidenceRaw ?? '' }];
    });
}

function SaveActions({
  saving,
  saved,
  onSave,
  onCancel,
}: {
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button onClick={onSave} disabled={saving} className="text-[12px] font-medium text-accent hover:text-accent/70 transition-colors disabled:opacity-40">
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saved && <span className="text-[12px] text-success">✓ Saved</span>}
      <button onClick={onCancel} disabled={saving} className="text-[12px] text-secondary hover:text-primary transition-colors disabled:opacity-40">
        Cancel
      </button>
    </div>
  );
}

function ProjectOverviewSection({
  detail,
  onChanged,
}: {
  detail: ProjectDetail;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(detail.project.title);
  const [status, setStatus] = useState(detail.project.status);
  const [objective, setObjective] = useState(detail.project.objective);
  const [currentStatus, setCurrentStatus] = useState(detail.project.currentStatus);
  const [blockers, setBlockers] = useState(detail.project.blockers ?? '');
  const [nextActions, setNextActions] = useState(detail.project.nextActions ?? '');

  useEffect(() => {
    setTitle(detail.project.title);
    setStatus(detail.project.status);
    setObjective(detail.project.objective);
    setCurrentStatus(detail.project.currentStatus);
    setBlockers(detail.project.blockers ?? '');
    setNextActions(detail.project.nextActions ?? '');
    setEditing(false);
    setError(null);
  }, [detail.project]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateProject(detail.id, {
        title,
        status,
        objective,
        currentStatus,
        blockers,
        nextActions,
      });
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SurfacePanel className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <SectionLabel label="Overview" />
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-[12px] text-secondary hover:text-primary transition-colors">
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="ui-section-label">Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT_CLASS} />
            </label>
            <label className="space-y-1.5">
              <span className="ui-section-label">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT_CLASS}>
                {['active', 'blocked', 'completed', 'on-hold', 'cancelled'].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="space-y-1.5 block">
            <span className="ui-section-label">Objective</span>
            <textarea value={objective} onChange={(e) => setObjective(e.target.value)} className={TEXTAREA_CLASS} />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5 block">
              <span className="ui-section-label">Current status</span>
              <textarea value={currentStatus} onChange={(e) => setCurrentStatus(e.target.value)} className={TEXTAREA_CLASS} />
            </label>
            <label className="space-y-1.5 block">
              <span className="ui-section-label">Next actions</span>
              <textarea value={nextActions} onChange={(e) => setNextActions(e.target.value)} className={TEXTAREA_CLASS} />
            </label>
          </div>

          <label className="space-y-1.5 block">
            <span className="ui-section-label">Blockers</span>
            <textarea value={blockers} onChange={(e) => setBlockers(e.target.value)} className={TEXTAREA_CLASS} />
          </label>

          {error && <p className="text-[12px] text-danger/80">{error}</p>}
          <SaveActions saving={saving} saved={saved} onSave={() => { void save(); }} onCancel={() => setEditing(false)} />
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1 min-w-0">
              <p className="ui-card-title text-lg">{detail.project.title}</p>
              <p className="ui-row-summary">{detail.project.objective}</p>
            </div>
            <Pill tone={projectTone(detail.project.status)}>{detail.project.status}</Pill>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <p className="ui-section-label">Current status</p>
              <p className="text-sm text-secondary whitespace-pre-wrap">{detail.project.currentStatus}</p>
            </div>
            <div className="space-y-1.5">
              <p className="ui-section-label">Next actions</p>
              <p className="text-sm text-secondary whitespace-pre-wrap">{detail.project.nextActions ?? 'No next actions recorded.'}</p>
            </div>
            <div className="space-y-1.5">
              <p className="ui-section-label">Blockers</p>
              <p className="text-sm text-secondary whitespace-pre-wrap">{detail.project.blockers ?? 'No blockers recorded.'}</p>
            </div>
            <div className="space-y-1.5">
              <p className="ui-section-label">Project stats</p>
              <div className="flex items-center gap-2 flex-wrap ui-card-meta">
                <span>{detail.tasks.length} {detail.tasks.length === 1 ? 'task' : 'tasks'}</span>
                <span className="opacity-40">·</span>
                <span>{detail.artifactCount} {detail.artifactCount === 1 ? 'artifact' : 'artifacts'}</span>
                <span className="opacity-40">·</span>
                <span>updated {timeAgo(detail.project.updatedAt)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </SurfacePanel>
  );
}

function PlanSection({
  detail,
  onChanged,
}: {
  detail: ProjectDetail;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState(detail.plan.objective);
  const [stepsText, setStepsText] = useState(formatPlanSteps(detail.plan.steps));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setObjective(detail.plan.objective);
    setStepsText(formatPlanSteps(detail.plan.steps));
    setEditing(false);
    setError(null);
  }, [detail.plan]);

  const done = detail.plan.steps.filter((step) => step.completed).length;
  const total = detail.plan.steps.length;

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateProjectPlan(detail.id, {
        objective,
        steps: parsePlanSteps(stepsText),
      });
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SurfacePanel className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SectionLabel label="Plan" count={`${done}/${total}`} />
        <div className="flex items-center gap-3">
          <span className="ui-card-meta">updated {timeAgo(detail.plan.updatedAt)}</span>
          {!editing && (
            <button onClick={() => setEditing(true)} className="text-[12px] text-secondary hover:text-primary transition-colors">
              Edit
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-3">
          <label className="space-y-1.5 block">
            <span className="ui-section-label">Objective</span>
            <textarea value={objective} onChange={(e) => setObjective(e.target.value)} className={TEXTAREA_CLASS} />
          </label>
          <label className="space-y-1.5 block">
            <span className="ui-section-label">Steps</span>
            <textarea value={stepsText} onChange={(e) => setStepsText(e.target.value)} className={`${TEXTAREA_CLASS} min-h-[180px] font-mono`} spellCheck={false} />
            <p className="ui-card-meta">Use one step per line. Prefix completed steps with <code>[x]</code>.</p>
          </label>
          {error && <p className="text-[12px] text-danger/80">{error}</p>}
          <SaveActions saving={saving} saved={saved} onSave={() => { void save(); }} onCancel={() => setEditing(false)} />
        </div>
      ) : (
        <div className="space-y-2">
          {detail.plan.steps.map((step, index) => (
            <div key={`${detail.id}-step-${index}`} className="flex items-start gap-3 text-sm text-secondary">
              <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${step.completed ? 'border-success/40 bg-success/10 text-success' : 'border-border-subtle bg-base/60 text-dim'}`}>
                {step.completed ? '✓' : index + 1}
              </span>
              <span className={step.completed ? 'text-secondary/80 line-through' : 'text-secondary'}>{step.text}</span>
            </div>
          ))}
        </div>
      )}
    </SurfacePanel>
  );
}

function NewTaskPanel({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [status, setStatus] = useState('backlog');
  const [criteriaText, setCriteriaText] = useState('');
  const [dependenciesText, setDependenciesText] = useState('');
  const [notes, setNotes] = useState('');

  function reset() {
    setTitle('');
    setObjective('');
    setStatus('backlog');
    setCriteriaText('');
    setDependenciesText('');
    setNotes('');
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.createProjectTask(projectId, {
        title,
        objective,
        status,
        acceptanceCriteria: parseLineList(criteriaText),
        dependencies: parseLineList(dependenciesText),
        notes,
      });
      reset();
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[12px] text-accent hover:text-accent/70 transition-colors">
        + New task
      </button>
    );
  }

  return (
    <SurfacePanel className="space-y-3">
      <SectionLabel label="New task" />
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className="ui-section-label">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="space-y-1.5">
          <span className="ui-section-label">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT_CLASS}>
            {['backlog', 'ready', 'running', 'blocked', 'done', 'cancelled'].map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="space-y-1.5 block">
        <span className="ui-section-label">Objective</span>
        <textarea value={objective} onChange={(e) => setObjective(e.target.value)} className={TEXTAREA_CLASS} />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5 block">
          <span className="ui-section-label">Acceptance criteria</span>
          <textarea value={criteriaText} onChange={(e) => setCriteriaText(e.target.value)} className={TEXTAREA_CLASS} />
        </label>
        <label className="space-y-1.5 block">
          <span className="ui-section-label">Dependencies</span>
          <textarea value={dependenciesText} onChange={(e) => setDependenciesText(e.target.value)} className={TEXTAREA_CLASS} />
        </label>
      </div>
      <label className="space-y-1.5 block">
        <span className="ui-section-label">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={TEXTAREA_CLASS} />
      </label>
      {error && <p className="text-[12px] text-danger/80">{error}</p>}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => { void save(); }} disabled={saving} className="text-[12px] font-medium text-accent hover:text-accent/70 transition-colors disabled:opacity-40">
          {saving ? 'Creating…' : 'Create task'}
        </button>
        <button onClick={() => { reset(); setOpen(false); }} disabled={saving} className="text-[12px] text-secondary hover:text-primary transition-colors disabled:opacity-40">
          Cancel
        </button>
      </div>
    </SurfacePanel>
  );
}

function TaskSummaryEditor({
  projectId,
  task,
  onChanged,
}: {
  projectId: string;
  task: ProjectTask;
  onChanged: () => void;
}) {
  const existing = task.summary;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState(existing?.outcome ?? '');
  const [summary, setSummary] = useState(existing?.summary ?? '');
  const [criteriaValidationText, setCriteriaValidationText] = useState(formatCriteriaValidation(existing?.criteriaValidation));
  const [keyChangesText, setKeyChangesText] = useState(formatLineList(existing?.keyChanges));
  const [artifactsText, setArtifactsText] = useState(formatLineList(existing?.artifacts));
  const [followUpsText, setFollowUpsText] = useState(formatLineList(existing?.followUps));

  useEffect(() => {
    setOutcome(existing?.outcome ?? '');
    setSummary(existing?.summary ?? '');
    setCriteriaValidationText(formatCriteriaValidation(existing?.criteriaValidation));
    setKeyChangesText(formatLineList(existing?.keyChanges));
    setArtifactsText(formatLineList(existing?.artifacts));
    setFollowUpsText(formatLineList(existing?.followUps));
    setEditing(false);
    setError(null);
  }, [existing?.updatedAt, existing?.outcome, existing?.summary]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateProjectTaskSummary(projectId, task.id, {
        outcome,
        summary,
        criteriaValidation: parseCriteriaValidation(criteriaValidationText),
        keyChanges: parseLineList(keyChangesText),
        artifacts: parseLineList(artifactsText),
        followUps: parseLineList(followUpsText),
      });
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="space-y-2 border-t border-border-subtle/70 pt-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <SectionLabel label="Completion summary" />
          <div className="flex items-center gap-3">
            {existing && <span className="ui-card-meta">updated {timeAgo(existing.updatedAt)}</span>}
            <button onClick={() => setEditing(true)} className="text-[12px] text-secondary hover:text-primary transition-colors">
              {existing ? 'Edit' : 'Add summary'}
            </button>
          </div>
        </div>

        {existing ? (
          <>
            <p className="text-sm font-medium text-primary">{existing.outcome}</p>
            <p className="text-sm text-secondary whitespace-pre-wrap">{existing.summary}</p>
            {existing.criteriaValidation && existing.criteriaValidation.length > 0 && (
              <div className="space-y-1.5">
                <p className="ui-section-label">Criteria validation</p>
                <div className="space-y-1.5 text-sm">
                  {existing.criteriaValidation.map((entry, index) => (
                    <div key={`${task.id}-summary-criterion-${index}`} className="flex items-start gap-2 text-secondary">
                      <Pill tone={entry.status === 'pass' ? 'success' : entry.status === 'fail' ? 'danger' : 'warning'}>
                        {entry.status}
                      </Pill>
                      <div className="min-w-0">
                        <p className="text-secondary">{entry.criterion}</p>
                        {entry.evidence && <p className="ui-card-meta mt-0.5">{entry.evidence}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-dim">No completion summary yet.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-border-subtle/70 pt-3">
      <SectionLabel label="Edit completion summary" />
      <label className="space-y-1.5 block">
        <span className="ui-section-label">Outcome</span>
        <input value={outcome} onChange={(e) => setOutcome(e.target.value)} className={INPUT_CLASS} />
      </label>
      <label className="space-y-1.5 block">
        <span className="ui-section-label">Summary</span>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} className={TEXTAREA_CLASS} />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5 block">
          <span className="ui-section-label">Criteria validation</span>
          <textarea value={criteriaValidationText} onChange={(e) => setCriteriaValidationText(e.target.value)} className={`${TEXTAREA_CLASS} min-h-[140px] font-mono`} spellCheck={false} />
          <p className="ui-card-meta">Use: <code>pass | criterion | evidence</code></p>
        </label>
        <label className="space-y-1.5 block">
          <span className="ui-section-label">Key changes</span>
          <textarea value={keyChangesText} onChange={(e) => setKeyChangesText(e.target.value)} className={TEXTAREA_CLASS} />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5 block">
          <span className="ui-section-label">Artifacts</span>
          <textarea value={artifactsText} onChange={(e) => setArtifactsText(e.target.value)} className={TEXTAREA_CLASS} />
        </label>
        <label className="space-y-1.5 block">
          <span className="ui-section-label">Follow-ups</span>
          <textarea value={followUpsText} onChange={(e) => setFollowUpsText(e.target.value)} className={TEXTAREA_CLASS} />
        </label>
      </div>
      {error && <p className="text-[12px] text-danger/80">{error}</p>}
      <SaveActions saving={saving} saved={saved} onSave={() => { void save(); }} onCancel={() => setEditing(false)} />
    </div>
  );
}

function TaskCard({
  projectId,
  task,
  onChanged,
}: {
  projectId: string;
  task: ProjectTask;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState(task.status);
  const [objective, setObjective] = useState(task.objective);
  const [criteriaText, setCriteriaText] = useState(formatLineList(task.acceptanceCriteria));
  const [dependenciesText, setDependenciesText] = useState(formatLineList(task.dependencies));
  const [notes, setNotes] = useState(task.notes ?? '');

  useEffect(() => {
    setTitle(task.title);
    setStatus(task.status);
    setObjective(task.objective);
    setCriteriaText(formatLineList(task.acceptanceCriteria));
    setDependenciesText(formatLineList(task.dependencies));
    setNotes(task.notes ?? '');
    setEditing(false);
    setError(null);
  }, [task.id, task.updatedAt, task.title, task.status, task.objective, task.notes, task.summary?.updatedAt]);

  async function saveTask() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateProjectTask(projectId, task.id, {
        title,
        status,
        objective,
        acceptanceCriteria: parseLineList(criteriaText),
        dependencies: parseLineList(dependenciesText),
        notes,
      });
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SurfacePanel className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1 min-w-0">
          <p className="ui-card-title">{task.title}</p>
          <p className="ui-row-summary">{task.objective}</p>
        </div>
        <div className="flex items-center gap-3">
          <Pill tone={taskTone(task.status)}>{task.status}</Pill>
          {!editing && (
            <button onClick={() => setEditing(true)} className="text-[12px] text-secondary hover:text-primary transition-colors">
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap ui-card-meta">
        <span>updated {timeAgo(task.updatedAt)}</span>
        {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
          <>
            <span className="opacity-40">·</span>
            <span>{task.acceptanceCriteria.length} criteria</span>
          </>
        )}
        {task.dependencies && task.dependencies.length > 0 && (
          <>
            <span className="opacity-40">·</span>
            <span>{task.dependencies.length} deps</span>
          </>
        )}
      </div>

      {editing ? (
        <div className="space-y-3 border-t border-border-subtle/70 pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="ui-section-label">Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT_CLASS} />
            </label>
            <label className="space-y-1.5">
              <span className="ui-section-label">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT_CLASS}>
                {['backlog', 'ready', 'running', 'blocked', 'done', 'cancelled'].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="space-y-1.5 block">
            <span className="ui-section-label">Objective</span>
            <textarea value={objective} onChange={(e) => setObjective(e.target.value)} className={TEXTAREA_CLASS} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5 block">
              <span className="ui-section-label">Acceptance criteria</span>
              <textarea value={criteriaText} onChange={(e) => setCriteriaText(e.target.value)} className={TEXTAREA_CLASS} />
            </label>
            <label className="space-y-1.5 block">
              <span className="ui-section-label">Dependencies</span>
              <textarea value={dependenciesText} onChange={(e) => setDependenciesText(e.target.value)} className={TEXTAREA_CLASS} />
            </label>
          </div>
          <label className="space-y-1.5 block">
            <span className="ui-section-label">Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={TEXTAREA_CLASS} />
          </label>
          {error && <p className="text-[12px] text-danger/80">{error}</p>}
          <SaveActions saving={saving} saved={saved} onSave={() => { void saveTask(); }} onCancel={() => setEditing(false)} />
        </div>
      ) : (
        <>
          {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
            <div className="space-y-2">
              <p className="ui-section-label">Acceptance criteria</p>
              <ul className="space-y-1.5 text-sm text-secondary list-disc pl-5">
                {task.acceptanceCriteria.map((criterion, index) => (
                  <li key={`${task.id}-criterion-${index}`}>{criterion}</li>
                ))}
              </ul>
            </div>
          )}

          {task.notes && (
            <div className="space-y-1.5">
              <p className="ui-section-label">Notes</p>
              <p className="text-sm text-secondary whitespace-pre-wrap">{task.notes}</p>
            </div>
          )}
        </>
      )}

      <TaskSummaryEditor projectId={projectId} task={task} onChanged={onChanged} />
    </SurfacePanel>
  );
}

function ProjectDetailPanel({
  detail,
  onChanged,
}: {
  detail: ProjectDetail;
  onChanged: () => void;
}) {
  const sortedTasks = useMemo(() => {
    const rank: Record<string, number> = {
      running: 0,
      blocked: 1,
      ready: 2,
      backlog: 3,
      done: 4,
      cancelled: 5,
    };

    return [...detail.tasks].sort((left, right) => {
      const rankDiff = (rank[left.status] ?? 99) - (rank[right.status] ?? 99);
      if (rankDiff !== 0) return rankDiff;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }, [detail.tasks]);

  return (
    <div className="space-y-4">
      <ProjectOverviewSection detail={detail} onChanged={onChanged} />
      <PlanSection detail={detail} onChanged={onChanged} />

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <SectionLabel label="Tasks" count={detail.tasks.length} />
          <NewTaskPanel projectId={detail.id} onChanged={onChanged} />
        </div>

        {detail.tasks.length === 0 ? (
          <EmptyState
            icon="☑️"
            title="No project tasks yet."
            body="Break the project plan into execution tasks to make progress inspectable."
          />
        ) : (
          <div className="space-y-3">
            {sortedTasks.map((task) => (
              <TaskCard key={task.id} projectId={detail.id} task={task} onChanged={onChanged} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { id: routeProjectId } = useParams<{ id?: string }>();
  const { data: projects, loading, error, refetch } = usePolling(api.projects, 15_000);

  const selectedProjectId = routeProjectId ?? projects?.[0]?.id;
  const {
    data: projectDetail,
    loading: detailLoading,
    error: detailError,
    refetch: refetchDetail,
  } = useApi<ProjectDetail | null>(
    () => selectedProjectId ? api.projectById(selectedProjectId) : Promise.resolve(null),
    selectedProjectId,
  );

  useEffect(() => {
    if (!routeProjectId && projects && projects.length > 0) {
      navigate(`/projects/${projects[0].id}`, { replace: true });
    }
  }, [navigate, projects, routeProjectId]);

  function refetchAll() {
    refetch();
    refetchDetail();
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader actions={<ToolbarButton onClick={refetchAll}>↻ Refresh</ToolbarButton>}>
        <PageHeading
          title="Projects"
          meta={
            projects && (
              <>
                {projects.length} {projects.length === 1 ? 'project' : 'projects'}
              </>
            )
          }
        />
      </PageHeader>

      <div className="flex-1 px-6 py-4 overflow-hidden">
        {loading && <LoadingState label="Loading projects…" />}
        {error && <ErrorState message={`Failed to load projects: ${error}`} />}
        {!loading && !error && projects?.length === 0 && (
          <EmptyState
            icon="🗂"
            title="No projects yet."
            body="Projects hold the durable plan, tasks, summaries, and artifacts for ongoing work."
          />
        )}

        {!loading && !error && projects && projects.length > 0 && (
          <div className="grid h-full gap-4 xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
            <div className="min-h-0 overflow-auto rounded-2xl border border-border-subtle bg-base/40">
              <div className="space-y-px p-2">
                {projects.map((project) => {
                  const isSelected = project.id === selectedProjectId;
                  return (
                    <ListLinkRow
                      key={project.id}
                      to={`/projects/${project.id}`}
                      selected={isSelected}
                      leading={<span className={`mt-2 h-2 w-2 rounded-full shrink-0 ${projectTone(project.status) === 'warning' ? 'bg-warning' : projectTone(project.status) === 'success' ? 'bg-success' : projectTone(project.status) === 'danger' ? 'bg-danger' : 'bg-teal'}`} />}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <p className="ui-card-title">{project.title}</p>
                          <Pill tone={projectTone(project.status)}>{project.status}</Pill>
                        </div>
                        <p className="ui-row-summary">{summarizeProject(project)}</p>
                        <div className="flex items-center gap-2 flex-wrap ui-card-meta">
                          <span>{timeAgo(project.updatedAt)}</span>
                          <span className="opacity-40">·</span>
                          <span className="font-mono text-[11px]">{project.id}</span>
                        </div>
                      </div>
                    </ListLinkRow>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 overflow-auto">
              {detailLoading && <LoadingState label="Loading project detail…" />}
              {!detailLoading && detailError && <ErrorState message={`Failed to load project: ${detailError}`} />}
              {!detailLoading && !detailError && projectDetail && <ProjectDetailPanel detail={projectDetail} onChanged={refetchAll} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
