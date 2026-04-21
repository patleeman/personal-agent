import { useSearchParams } from 'react-router-dom';
import { VaultEditor } from '../components/knowledge/VaultEditor';

export function KnowledgePage() {
  const [searchParams] = useSearchParams();
  const activeFileId = searchParams.get('file') ?? null;

  const fileName = activeFileId
    ? activeFileId.split('/').filter(Boolean).pop()
    : undefined;

  return (
    <div className="flex h-full">
      <VaultEditor
        fileId={activeFileId}
        fileName={fileName}
        key={activeFileId ?? '__empty'}
      />
    </div>
  );
}
