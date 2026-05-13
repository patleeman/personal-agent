import { cx, useApi, useInvalidateOnTopics } from '@personal-agent/extensions/settings';
import { useEffect, useMemo, useState } from 'react';

import { knowledgeApi } from '../lib/knowledgeApi';
import { getKnowledgeBaseSyncPresentation } from '../lib/knowledgeBaseSyncStatus';

const INPUT_CLASS =
  'w-full rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-[13px] text-primary shadow-none transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none';

export function KnowledgeSettingsPanel({ variant = 'settings' }: { variant?: 'settings' | 'onboarding' } = {}) {
  const {
    data: knowledgeBaseState,
    loading: knowledgeBaseLoading,
    error: knowledgeBaseLoadError,
    refetch: refetchKnowledgeBase,
  } = useApi(knowledgeApi.state, 'knowledge-settings-knowledge-base');
  const [repoUrlDraft, setRepoUrlDraft] = useState('');
  const [branchDraft, setBranchDraft] = useState('main');
  const [action, setAction] = useState<'save' | 'sync' | null>(null);
  const [actionStartedAt, setActionStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = knowledgeBaseState
    ? repoUrlDraft.trim() !== knowledgeBaseState.repoUrl || branchDraft.trim() !== knowledgeBaseState.branch
    : false;
  const isOnboarding = variant === 'onboarding';
  const syncPresentation = useMemo(
    () => getKnowledgeBaseSyncPresentation(knowledgeBaseState, { includeLastSyncAt: true }),
    [knowledgeBaseState],
  );

  useInvalidateOnTopics(['knowledgeBase'], refetchKnowledgeBase);

  const actionProgressText = useMemo(() => {
    if (action === null) {
      return null;
    }

    const verb = action === 'save' ? 'Connecting repository' : 'Syncing knowledge base';
    if (elapsedSeconds < 3) {
      return `${verb}…`;
    }
    if (elapsedSeconds < 10) {
      return `${verb}… cloning and reading git state (${elapsedSeconds}s)`;
    }
    return `${verb}… still waiting on git (${elapsedSeconds}s). If this is a private repo, check whether git is prompting for credentials.`;
  }, [action, elapsedSeconds]);

  useEffect(() => {
    if (knowledgeBaseState) {
      setRepoUrlDraft(knowledgeBaseState.repoUrl);
      setBranchDraft(knowledgeBaseState.branch);
    }
  }, [knowledgeBaseState?.repoUrl, knowledgeBaseState?.branch]);

  useEffect(() => {
    if (action === null || actionStartedAt === null) {
      setElapsedSeconds(0);
      return undefined;
    }

    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - actionStartedAt) / 1000)));
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 500);
    return () => {
      window.clearInterval(interval);
    };
  }, [action, actionStartedAt]);

  async function save(nextInput?: { repoUrl?: string | null; branch?: string | null }) {
    if (!knowledgeBaseState || action !== null) {
      return;
    }

    const repoUrl = typeof nextInput?.repoUrl === 'string' ? nextInput.repoUrl.trim() : repoUrlDraft.trim();
    const branch = typeof nextInput?.branch === 'string' ? nextInput.branch.trim() : branchDraft.trim();
    if (!nextInput && !dirty) {
      return;
    }

    setSaveError(null);
    setActionStartedAt(Date.now());
    setAction('save');

    try {
      const saved = await knowledgeApi.updateState({ repoUrl: repoUrl || null, branch: branch || null });
      setRepoUrlDraft(saved.repoUrl);
      setBranchDraft(saved.branch);
      await refetchKnowledgeBase({ resetLoading: false });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setAction(null);
      setActionStartedAt(null);
    }
  }

  async function sync() {
    if (!knowledgeBaseState || !knowledgeBaseState.configured || action !== null) {
      return;
    }

    setSaveError(null);
    setActionStartedAt(Date.now());
    setAction('sync');

    try {
      const synced = await knowledgeApi.sync();
      setRepoUrlDraft(synced.repoUrl);
      setBranchDraft(synced.branch);
      await refetchKnowledgeBase({ resetLoading: false });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setAction(null);
      setActionStartedAt(null);
    }
  }

  useEffect(() => {
    if (isOnboarding || !knowledgeBaseState || !dirty || action !== null) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      void save();
    }, 700);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [action, branchDraft, dirty, isOnboarding, knowledgeBaseState, repoUrlDraft]);

  if (knowledgeBaseLoading && !knowledgeBaseState) {
    return <p className="ui-card-meta">Loading knowledge base…</p>;
  }

  if (knowledgeBaseLoadError && !knowledgeBaseState) {
    return <p className="text-[12px] text-danger">Failed to load knowledge base: {knowledgeBaseLoadError}</p>;
  }

  if (!knowledgeBaseState) {
    return null;
  }

  return (
    <>
      <form
        className={isOnboarding ? 'space-y-4' : 'space-y-3'}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="space-y-1.5">
          <label
            className={isOnboarding ? 'text-[12px] font-semibold text-secondary' : 'ui-card-meta'}
            htmlFor="settings-knowledge-base-repo"
          >
            Repository
          </label>
          <input
            id="settings-knowledge-base-repo"
            name="knowledge-base-repo-url"
            type="text"
            value={repoUrlDraft}
            onChange={(event) => {
              setRepoUrlDraft(event.target.value);
              if (saveError) setSaveError(null);
            }}
            className={`${INPUT_CLASS} min-w-0 flex-1 font-mono text-[13px]`}
            placeholder="git@github.com:you/knowledge-base.git, https://github.com/you/kb.git, or /path/to/repo"
            autoComplete="off"
            spellCheck={false}
            disabled={action !== null}
          />
          {isOnboarding ? (
            <p className="text-[12px] leading-5 text-dim">
              Use an SSH/HTTPS remote or a local git repository path. Private repos use your local git credentials.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <label
            className={isOnboarding ? 'text-[12px] font-semibold text-secondary' : 'ui-card-meta'}
            htmlFor="settings-knowledge-base-branch"
          >
            Branch
          </label>
          <input
            id="settings-knowledge-base-branch"
            name="knowledge-base-branch"
            value={branchDraft}
            onChange={(event) => {
              setBranchDraft(event.target.value);
              if (saveError) setSaveError(null);
            }}
            className={`${INPUT_CLASS} min-w-0 flex-1 font-mono text-[13px]`}
            placeholder="main"
            autoComplete="off"
            spellCheck={false}
            disabled={action !== null}
          />
        </div>
        {isOnboarding ? null : (
          <>
            <p className="ui-card-meta break-all">
              Local mirror · <span className="font-mono text-[11px]">{knowledgeBaseState.managedRoot}</span>
            </p>
            <p className={cx('ui-card-meta break-all', action === null && syncPresentation.toneClass)}>
              {actionProgressText ?? syncPresentation.text}
            </p>
            <p className="ui-card-meta break-all">
              Recovery copies · <span className="font-mono text-[11px]">{knowledgeBaseState.recoveryDir}</span> ·{' '}
              {knowledgeBaseState.recoveredEntryCount} saved
            </p>
          </>
        )}
        {isOnboarding ? (
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={action !== null || repoUrlDraft.trim().length === 0}
              className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:bg-dim/45 disabled:text-white/80"
            >
              {action === 'save' ? 'Connecting…' : 'Connect Repository'}
            </button>
            <span className="text-[12px] text-dim">You can change this later in Settings.</span>
          </div>
        ) : null}
        {isOnboarding && actionProgressText ? (
          <div
            className="rounded-lg border border-border-subtle bg-surface/60 px-3 py-2 text-[12px] leading-5 text-secondary"
            role="status"
          >
            <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-border-subtle">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-accent/80" />
            </div>
            {actionProgressText}
          </div>
        ) : null}
        {isOnboarding ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-card-meta">{action === 'save' ? 'Saving…' : dirty ? 'Auto-save pending…' : 'Auto-saved'}</span>
            <button
              type="button"
              onClick={() => {
                void sync();
              }}
              disabled={action !== null || !knowledgeBaseState.configured}
              className={ACTION_BUTTON_CLASS}
            >
              {action === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              type="button"
              onClick={() => {
                setRepoUrlDraft('');
                setBranchDraft('main');
                void save({ repoUrl: '', branch: 'main' });
              }}
              disabled={action !== null || !knowledgeBaseState.configured}
              className={ACTION_BUTTON_CLASS}
            >
              Disable managed sync
            </button>
          </div>
        )}
        {isOnboarding ? null : (
          <p className="ui-card-meta">
            PA keeps a local clone under runtime state, syncs it in the background, and treats git as the backing store. Use an SSH/HTTPS
            remote or a local git repository path. Folder and file @ mentions read from the local mirror.
          </p>
        )}
      </form>

      {saveError && <p className="text-[12px] text-danger">{saveError}</p>}
    </>
  );
}
