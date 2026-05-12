import { type NativeExtensionClient } from '@personal-agent/extensions';
import { api } from '@personal-agent/extensions/data';
import { useState } from 'react';

interface FilePickerResult {
  paths: string[];
  cancelled: boolean;
}

interface ImportSessionButtonProps {
  pa: NativeExtensionClient;
  actionContext?: {
    cwd?: string | null;
  };
}

const dataApi = api as {
  pickFiles(cwd?: string): Promise<FilePickerResult>;
};

function ImportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 4.5v9" strokeLinecap="round" />
      <path d="m8.25 10.5 3.75 3.75 3.75-3.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.25 16.5v1.25A1.75 1.75 0 0 0 7 19.5h10a1.75 1.75 0 0 0 1.75-1.75V16.5" strokeLinecap="round" />
    </svg>
  );
}

export function ImportSessionButton({ pa, actionContext }: ImportSessionButtonProps) {
  const [busy, setBusy] = useState(false);

  async function importSession() {
    if (busy) return;

    setBusy(true);
    try {
      const cwd = actionContext?.cwd?.trim() || undefined;
      const selection = await dataApi.pickFiles(cwd);
      if (selection.cancelled || selection.paths.length === 0) return;

      const [filePath] = selection.paths;
      await pa.extension.invoke('importSession', { filePath });
    } catch (error) {
      pa.ui.toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void importSession()}
      className="ui-icon-button ui-icon-button-compact shrink-0"
      title={busy ? 'Importing session…' : 'Import session'}
      aria-label={busy ? 'Importing session…' : 'Import session'}
      disabled={busy}
    >
      <ImportIcon />
    </button>
  );
}
