import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { VaultEditor } from '../components/knowledge/VaultEditor';

export function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFileId = searchParams.get('file') ?? null;

  const handleFileNavigate = useCallback((id: string) => {
    if (!id) {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ file: id }, { replace: true });
    }
  }, [setSearchParams]);

  const handleFileRenamed = useCallback((oldId: string, newId: string) => {
    if (activeFileId === oldId) {
      setSearchParams({ file: newId }, { replace: true });
    }
  }, [activeFileId, setSearchParams]);

  const fileName = activeFileId
    ? activeFileId.split('/').filter(Boolean).pop()
    : undefined;

  return (
    <div className="flex h-full">
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
