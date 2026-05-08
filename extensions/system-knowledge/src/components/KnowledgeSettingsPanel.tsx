import { cx, useApi, useInvalidateOnTopics } from '@personal-agent/extensions/settings';
import { useEffect, useMemo, useState } from 'react';

import { knowledgeApi } from '../lib/knowledgeApi';
import { getKnowledgeBaseSyncPresentation } from '../lib/knowledgeBaseSyncStatus';

const INPUT_CLASS =
  'w-full rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-[13px] text-primary shadow-none transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none';

export function KnowledgeSettingsPanel() {
  const {
    data: knowledgeBaseState,
    loading: knowledgeBaseLoading,
    error: knowledgeBaseLoadError,
    refetch: refetchKnowledgeBase,
  } = useApi(knowledgeApi.state, 'knowledge-settings-knowledge-base');
  const [repoUrlDraft, setRepoUrlDraft] = useState('');
  const [branchDraft, setBranchDraft] = useState('main');
  const [action, setAction] = useState<'save' | 'sync' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = knowledgeBaseState
    ? repoUrlDraft.trim() !== knowledgeBaseState.repoUrl || branchDraft.trim() !== knowledgeBaseState.branch
    : false;
  const syncPresentation = useMemo(
    () => getKnowledgeBaseSyncPresentation(knowledgeBaseState, { includeLastSyncAt: true }),
    [knowledgeBaseState],
  );

  useInvalidateOnTopics(['knowledgeBase'], refetchKnowledgeBase);

  useEffect(() => {
    if (knowledgeBaseState) {
      setRepoUrlDraft(knowledgeBaseState.repoUrl);
      setBranchDraft(knowledgeBaseState.branch);
    }
  }, [knowledgeBaseState?.repoUrl, knowledgeBaseState?.branch]);

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
    }
  }

  async function sync() {
    if (!knowledgeBaseState || !knowledgeBaseState.configured || action !== null) {
      return;
    }

    setSaveError(null);
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
    }
  }

  useEffect(() => {
    if (!knowledgeBaseState || !dirty || action !== null) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      void save();
    }, 700);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [action, branchDraft, dirty, knowledgeBaseState, repoUrlDraft]);

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
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="ui-card-meta" htmlFor="settings-knowledge-base-repo">
          Repo URL
        </label>
        <input
          id="settings-knowledge-base-repo"
          value={repoUrlDraft}
          onChange={(event) => {
            setRepoUrlDraft(event.target.value);
            if (saveError) setSaveError(null);
          }}
          className={`${INPUT_CLASS} min-w-0 flex-1 font-mono text-[13px]`}
          placeholder="https://github.com/you/knowledge-base.git"
          autoComplete="off"
          spellCheck={false}
          disabled={action !== null}
        />
        <label className="ui-card-meta" htmlFor="settings-knowledge-base-branch">
          Branch
        </label>
        <input
          id="settings-knowledge-base-branch"
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
        <p className="ui-card-meta break-all">
          Local mirror · <span className="font-mono text-[11px]">{knowledgeBaseState.managedRoot}</span>
        </p>
        <p className={cx('ui-card-meta break-all', action === null && syncPresentation.toneClass)}>
          {action === 'save' ? 'Saving knowledge base…' : action === 'sync' ? 'Syncing knowledge base…' : syncPresentation.text}
        </p>
        <p className="ui-card-meta break-all">
          Recovery copies · <span className="font-mono text-[11px]">{knowledgeBaseState.recoveryDir}</span> ·{' '}
          {knowledgeBaseState.recoveredEntryCount} saved
        </p>
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
        <p className="ui-card-meta">
          PA keeps a local clone under runtime state, syncs it in the background, and treats git as the backing store. Folder and file @
          mentions read from that local mirror.
        </p>
      </form>

      {saveError && <p className="text-[12px] text-danger">{saveError}</p>}
    </>
  );
}
