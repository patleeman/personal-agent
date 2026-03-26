import { useCallback, useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import {
  formatProjectStatus,
  getPlanProgress,
  hasMeaningfulBlockers,
  isProjectArchived,
  pickCurrentMilestone,
  summarizeProjectPreview,
} from '../contextRailProject';
import { useApi } from '../hooks';
import { timeAgo } from '../utils';
import { NodeLinkList, UnresolvedNodeLinks } from '../components/NodeLinksSection';
import { CompanionMarkdown } from './CompanionMarkdown';
import { buildCompanionConversationPath, COMPANION_PROJECTS_PATH } from './routes';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border-subtle px-4 py-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function CompanionProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const fetchProject = useCallback(() => {
    if (!id) {
      throw new Error('Missing project id.');
    }

    return api.projectById(id);
  }, [id]);
  const { data, loading, refreshing, error, refetch } = useApi(fetchProject, `companion-project:${id ?? ''}`);

  const project = data?.project ?? null;
  const blockers = useMemo(
    () => (project?.blockers ?? []).map((blocker) => blocker.trim()).filter((blocker) => blocker.length > 0),
    [project?.blockers],
  );
  const currentMilestone = project ? pickCurrentMilestone(project.plan) : undefined;
  const progress = project ? getPlanProgress(project.plan.milestones) : { done: 0, total: 0, pct: 0 };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border-subtle bg-base/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <div className="flex items-center justify-between gap-3">
            <Link to={COMPANION_PROJECTS_PATH} className="text-[12px] font-medium text-accent">← Projects</Link>
            <button
              type="button"
              onClick={() => { void refetch({ resetLoading: false }); }}
              disabled={refreshing}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">assistant companion</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-primary">{project?.title ?? 'Project'}</h1>
          {project ? (
            <>
              <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-secondary">{summarizeProjectPreview(project)}</p>
              <p className="mt-3 break-words text-[12px] text-dim">
                {formatProjectStatus(project.status)}
                <span className="mx-1.5 opacity-40">·</span>
                {isProjectArchived(project) && project.archivedAt ? `archived ${timeAgo(project.archivedAt)}` : `updated ${timeAgo(project.updatedAt)}`}
                <span className="mx-1.5 opacity-40">·</span>
                @{project.id}
              </p>
            </>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-6">
          {loading ? <p className="px-4 text-[13px] text-dim">Loading project…</p> : null}
          {!loading && error ? <p className="px-4 text-[13px] text-danger">Unable to load project: {error}</p> : null}
          {!loading && !error && !data ? <p className="px-4 text-[13px] text-dim">Project not found.</p> : null}

          {data && project ? (
            <div className="overflow-hidden border-y border-border-subtle bg-surface/70">
              {project.currentFocus ? (
                <Section title="Current focus">
                  <p className="text-[14px] leading-relaxed text-primary">{project.currentFocus}</p>
                </Section>
              ) : null}

              {(project.requirements.goal.trim().length > 0 || project.requirements.acceptanceCriteria.length > 0) ? (
                <Section title="Definition of done">
                  {project.requirements.goal.trim().length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Goal</p>
                      <CompanionMarkdown content={project.requirements.goal} />
                    </div>
                  ) : null}
                  {project.requirements.acceptanceCriteria.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Acceptance criteria</p>
                      <ul className="space-y-2 pl-4 text-[14px] leading-relaxed text-primary list-disc">
                        {project.requirements.acceptanceCriteria.map((criterion) => (
                          <li key={criterion}>{criterion}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </Section>
              ) : null}

              <Section title="Plan">
                <p className="text-[13px] text-secondary">
                  {progress.total > 0
                    ? `${progress.done}/${progress.total} milestones complete · ${progress.pct}% done`
                    : 'No milestones yet.'}
                </p>
                {currentMilestone ? (
                  <div className="rounded-xl bg-base/65 px-3 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Current milestone</p>
                    <p className="mt-2 text-[15px] font-medium text-primary">{currentMilestone.title}</p>
                    <p className="mt-1 text-[12px] text-dim">{formatProjectStatus(currentMilestone.status)}</p>
                    {currentMilestone.summary ? <p className="mt-2 text-[13px] leading-relaxed text-secondary">{currentMilestone.summary}</p> : null}
                  </div>
                ) : null}
                {data.tasks.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Tasks</p>
                    <div className="space-y-2">
                      {data.tasks.map((task) => (
                        <div key={task.id} className="rounded-xl bg-base/65 px-3 py-3">
                          <p className="text-[14px] font-medium text-primary">{task.title}</p>
                          <p className="mt-1 text-[12px] text-dim">{formatProjectStatus(task.status)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Section>

              {hasMeaningfulBlockers(project.blockers) ? (
                <Section title="Blockers">
                  <ul className="space-y-2 pl-4 text-[14px] leading-relaxed text-warning list-disc">
                    {blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              {data.brief?.content ? (
                <Section title="Brief">
                  <CompanionMarkdown content={data.brief.content} />
                </Section>
              ) : null}

              {data.notes.length > 0 ? (
                <Section title="Notes">
                  {data.notes.map((note) => (
                    <div key={note.id} className="rounded-xl bg-base/65 px-3 py-3">
                      <p className="text-[14px] font-medium text-primary">{note.title}</p>
                      <p className="mt-1 text-[11px] text-dim">{note.kind} · updated {timeAgo(note.updatedAt)}</p>
                      {note.body ? <CompanionMarkdown content={note.body} className="ui-markdown mt-3 max-w-none text-[13px] leading-relaxed" /> : null}
                    </div>
                  ))}
                </Section>
              ) : null}

              <Section title="Relationships">
                <NodeLinkList
                  title="Links to"
                  items={data.links?.outgoing}
                  surface="companion"
                  emptyText="This project does not reference other nodes yet."
                />
                <NodeLinkList
                  title="Linked from"
                  items={data.links?.incoming}
                  surface="companion"
                  emptyText="No other nodes link to this project yet."
                />
                <UnresolvedNodeLinks ids={data.links?.unresolved} />
              </Section>

              {data.linkedConversations.length > 0 ? (
                <Section title="Linked conversations">
                  <div className="space-y-2">
                    {data.linkedConversations.map((conversation) => (
                      <Link
                        key={conversation.conversationId}
                        to={buildCompanionConversationPath(conversation.conversationId)}
                        className="block rounded-xl bg-base/65 px-3 py-3 transition-colors hover:bg-base"
                      >
                        <p className="text-[14px] font-medium text-primary">{conversation.title}</p>
                        <p className="mt-1 text-[12px] text-dim">
                          {conversation.isRunning ? 'running' : conversation.needsAttention ? 'needs review' : 'saved'}
                          {conversation.lastActivityAt ? ` · ${timeAgo(conversation.lastActivityAt)}` : ''}
                        </p>
                        {conversation.snippet ? <p className="mt-2 text-[13px] leading-relaxed text-secondary">{conversation.snippet}</p> : null}
                      </Link>
                    ))}
                  </div>
                </Section>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
