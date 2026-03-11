import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { formatProjectStatus, hasMeaningfulBlockers, summarizeProjectPreview } from '../contextRailProject';
import { useApi } from '../hooks';
import { useAppData } from '../contexts';
import { emitProjectsChanged, PROJECTS_CHANGED_EVENT } from '../projectEvents';
import { timeAgo } from '../utils';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, ToolbarButton } from '../components/ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary focus:outline-none focus:border-accent/60';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[104px] resize-y leading-relaxed`;

function CreateProjectPanel({
  onCreated,
  onCancel,
}: {
  onCreated: (projectId: string) => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState('');
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const detail = await api.createProject({
        description,
        summary: summary.trim() || undefined,
      });
      emitProjectsChanged();
      onCreated(detail.project.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0 space-y-5 border-t border-border-subtle pt-5">
      <div className="space-y-1">
        <h2 className="text-[15px] font-medium text-primary">New project</h2>
        <p className="ui-card-meta max-w-2xl">
          Create a project from a short description. The ID is auto-generated, and you can fill in the rest after creation.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-3xl space-y-5">
        <div className="space-y-1.5">
          <label className="ui-card-meta" htmlFor="project-description">Description</label>
          <textarea
            id="project-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={TEXTAREA_CLASS}
            placeholder="Describe the project at a high level."
          />
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta" htmlFor="project-summary">Initial summary</label>
          <textarea
            id="project-summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            className={TEXTAREA_CLASS}
            placeholder="Optional. A current snapshot of the project state."
          />
        </div>

        {error && <p className="text-[12px] text-danger">{error}</p>}

        <div className="flex items-center gap-3">
          <ToolbarButton type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create project'}</ToolbarButton>
          <button type="button" onClick={onCancel} className="text-[13px] text-secondary hover:text-primary transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { id: selectedId } = useParams<{ id?: string }>();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const { data, loading, error, refetch } = useApi(api.projects);
  const { projects: projectSnapshot, setProjects } = useAppData();

  const projects = projectSnapshot ?? data ?? null;
  const isLoading = projectSnapshot === null && loading;
  const visibleError = projectSnapshot === null ? error : null;

  const refreshProjects = useCallback(async () => {
    const next = await refetch();
    if (next) {
      setProjects(next);
    }
    return next;
  }, [refetch, setProjects]);

  useEffect(() => {
    function handleProjectsChanged() {
      void refreshProjects();
    }

    window.addEventListener(PROJECTS_CHANGED_EVENT, handleProjectsChanged);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, handleProjectsChanged);
  }, [refreshProjects]);

  useEffect(() => {
    if (selectedId) {
      setShowCreateForm(false);
    }
  }, [selectedId]);

  function openCreateForm() {
    navigate('/projects');
    setShowCreateForm(true);
  }

  function handleCreated(projectId: string) {
    setShowCreateForm(false);
    navigate(`/projects/${projectId}`);
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        actions={(
          <>
            <ToolbarButton onClick={() => {
              if (showCreateForm) {
                setShowCreateForm(false);
                return;
              }

              openCreateForm();
            }}>
              {showCreateForm ? 'Close new project' : '+ New project'}
            </ToolbarButton>
            <ToolbarButton onClick={() => { void refreshProjects(); }}>↻ Refresh</ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="Projects"
          meta={(
            projects && (
              <>
                {projects.length} {projects.length === 1 ? 'project' : 'projects'}
              </>
            )
          )}
        />
      </PageHeader>

      <div className="flex-1 px-6 py-4">
        {isLoading && <LoadingState label="Loading projects…" />}
        {visibleError && <ErrorState message={`Failed to load projects: ${visibleError}`} />}

        {!isLoading && !visibleError && projects?.length === 0 && !showCreateForm && (
          <EmptyState
            title="No projects yet."
            body="Projects track ongoing work, milestones, and tasks."
            action={<ToolbarButton onClick={openCreateForm}>Create project</ToolbarButton>}
          />
        )}

        {!isLoading && !visibleError && (showCreateForm || (projects && projects.length > 0)) && (
          <div className="space-y-6">
            {showCreateForm && (
              <CreateProjectPanel
                onCreated={handleCreated}
                onCancel={() => setShowCreateForm(false)}
              />
            )}

            {projects && projects.length > 0 && (
              <div className="space-y-px">
                {projects.map((project) => {
                  const status = formatProjectStatus(project.status);
                  const blockers = project.blockers.filter((blocker) => blocker.trim().length > 0);
                  const isBlocked = hasMeaningfulBlockers(project.blockers);
                  const isSelected = project.id === selectedId;
                  const preview = summarizeProjectPreview(project);
                  const dotClass = isBlocked ? 'bg-warning' : 'bg-teal';

                  return (
                    <ListLinkRow
                      key={project.id}
                      to={`/projects/${project.id}`}
                      selected={isSelected}
                      leading={<span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${dotClass}`} />}
                    >
                      <p className="ui-card-title">{project.description}</p>
                      <p className="ui-row-summary">{preview}</p>
                      <div className="flex items-center gap-1.5 flex-wrap ui-card-meta">
                        <span>{status}</span>
                        <span className="opacity-40">·</span>
                        <span className="font-mono">{project.id}</span>
                        <span className="opacity-40">·</span>
                        <span>{timeAgo(project.updatedAt)}</span>
                        {isBlocked && blockers[0] && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="text-warning">{blockers[0]}</span>
                          </>
                        )}
                      </div>
                    </ListLinkRow>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
