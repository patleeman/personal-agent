import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../client/api';
import { VaultEditor } from '../components/knowledge/VaultEditor';
import { AppPageEmptyState, AppPageIntro, AppPageLayout } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { navigateKnowledgeFile } from '../knowledge/knowledgeNavigation';

export function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFileId = searchParams.get('file') ?? null;
  const {
    data: knowledgeBaseState,
    loading: knowledgeBaseLoading,
  } = useApi(api.knowledgeBase, 'knowledge-page-knowledge-base');
  const handleFileNavigate = useCallback((id: string) => {
    navigateKnowledgeFile(setSearchParams, id);
  }, [setSearchParams]);

  const handleFileRenamed = useCallback((oldId: string, newId: string) => {
    if (activeFileId === oldId) {
      navigateKnowledgeFile(setSearchParams, newId, { replace: true });
    }
  }, [activeFileId, setSearchParams]);

  const fileName = activeFileId
    ? activeFileId.split('/').filter(Boolean).pop()
    : undefined;

  if (knowledgeBaseLoading && !knowledgeBaseState) {
    return (
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="max-w-[72rem] flex min-h-full flex-col gap-10">
          <AppPageIntro
            title="Knowledge"
            summary="Browse and edit files from the managed knowledge repo."
          />
          <AppPageEmptyState
            align="start"
            title="Loading knowledge base…"
            body="Checking whether managed sync is enabled."
          />
        </AppPageLayout>
      </div>
    );
  }

  if (knowledgeBaseState?.configured === false) {
    return (
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="max-w-[72rem] flex min-h-full flex-col gap-10">
          <AppPageIntro
            title="Knowledge"
            summary="Browse and edit files from the managed knowledge repo."
          />
          <AppPageEmptyState
            align="start"
            title="Sync a repo to enable Knowledge"
            body="The Knowledge UI stays empty until a managed repo is configured."
            action={<Link to="/settings#settings-general" className="ui-toolbar-button">Open Settings</Link>}
          />
        </AppPageLayout>
      </div>
    );
  }

  if (!activeFileId) {
    return (
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="max-w-[72rem] flex min-h-full flex-col gap-10">
          <AppPageIntro
            title="Knowledge"
            summary="Browse and edit files from the managed knowledge repo."
          />
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
        fileId={activeFileId}
        fileName={fileName}
        onFileNavigate={handleFileNavigate}
        onFileRenamed={handleFileRenamed}
        key={activeFileId ?? '__empty'}
      />
    </div>
  );
}
