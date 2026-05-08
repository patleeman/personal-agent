import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { VaultEditor } from '../../../../../extensions/system-knowledge/src/components/VaultEditor';
import { navigateKnowledgeFile } from '../../../../../extensions/system-knowledge/src/lib/knowledgeNavigation';
import { api } from '../client/api';
import { AppPageEmptyState, AppPageIntro, AppPageLayout } from '../components/ui';
import { useApi } from '../hooks/useApi';

export function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFileId = searchParams.get('file') ?? null;
  const { data: knowledgeBaseState, loading: knowledgeBaseLoading } = useApi(api.knowledgeBase, 'knowledge-page-knowledge-base');
  const handleFileNavigate = useCallback(
    (id: string) => {
      navigateKnowledgeFile(setSearchParams, id);
    },
    [setSearchParams],
  );

  const handleFileRenamed = useCallback(
    (oldId: string, newId: string) => {
      if (activeFileId === oldId) {
        navigateKnowledgeFile(setSearchParams, newId, { replace: true });
      }
    },
    [activeFileId, setSearchParams],
  );

  const fileName = activeFileId ? activeFileId.split('/').filter(Boolean).pop() : undefined;

  if (knowledgeBaseLoading && !knowledgeBaseState) {
    return (
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="max-w-[72rem] flex min-h-full flex-col gap-10">
          <AppPageIntro title="Knowledge" />
          <AppPageEmptyState align="start" title="Loading knowledge base…" body="Checking whether managed sync is enabled." />
        </AppPageLayout>
      </div>
    );
  }

  if (knowledgeBaseState?.configured === false) {
    return (
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="max-w-[72rem] flex min-h-full flex-col gap-10">
          <AppPageIntro title="Knowledge" />
          <AppPageEmptyState
            align="start"
            title="Connect a git repo to start using Knowledge"
            body={
              <div className="space-y-3 leading-6">
                <p>
                  Knowledge stores durable docs, skills, and instruction files in a git repository. PA clones the repo, watches for local
                  edits, and syncs changes automatically.
                </p>
                <div className="rounded-2xl border border-border-subtle bg-surface px-4 py-3">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-dim">Setup</p>
                  <ol className="ml-4 list-decimal space-y-1.5 text-[13px]">
                    <li>Create a git repository (GitHub, self-hosted, or any remote). It can be empty or already have content.</li>
                    <li>
                      Copy the clone URL — HTTPS format like{' '}
                      <code className="rounded bg-elevated px-1 py-0.5 font-mono text-[12px]">
                        https://github.com/you/knowledge-base.git
                      </code>
                    </li>
                    <li>Paste it in Settings and PA will clone and manage the rest.</li>
                  </ol>
                </div>
                <p className="text-[12px] text-dim">Private repos work too — PA uses git credential helpers from the environment.</p>
              </div>
            }
            action={
              <Link to="/settings#settings-general" className="ui-toolbar-button">
                Open Settings
              </Link>
            }
          />
        </AppPageLayout>
      </div>
    );
  }

  if (!activeFileId) {
    return (
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="max-w-[72rem] flex min-h-full flex-col gap-10">
          <AppPageIntro title="Knowledge" />
          <AppPageEmptyState
            align="start"
            title="Select a file to start editing"
            body="Pick a note from the sidebar, or import a URL into the knowledge base."
          />
        </AppPageLayout>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 min-w-0">
      <VaultEditor
        // Keep the editor instance stable across file switches. Re-mounting the
        // whole TipTap tree on every click is expensive and caused knowledge-page
        // interaction spikes in the desktop app.
        fileId={activeFileId}
        fileName={fileName}
        onFileNavigate={handleFileNavigate}
        onFileRenamed={handleFileRenamed}
      />
    </div>
  );
}
