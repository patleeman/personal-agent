import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { NoteEditorDocument } from '../components/NoteEditorDocument';
import type { MemoryDocDetail } from '../types';
import { buildCompanionNotePath, COMPANION_NOTES_PATH } from './routes';

const COMPANION_QUICK_NOTE_DRAFT_STORAGE_KEY = 'pa-companion-quick-note-draft';
const DEFAULT_QUICK_NOTE_TITLE = 'Quick note';

function readStoredDraft(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    return window.localStorage.getItem(COMPANION_QUICK_NOTE_DRAFT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeStoredDraft(value: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (value.trim().length === 0) {
      window.localStorage.removeItem(COMPANION_QUICK_NOTE_DRAFT_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(COMPANION_QUICK_NOTE_DRAFT_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures on constrained browsers.
  }
}

export function CompanionQuickNotePage() {
  const [body, setBody] = useState(() => readStoredDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<MemoryDocDetail | null>(null);

  useEffect(() => {
    writeStoredDraft(body);
  }, [body]);

  const canSave = body.trim().length > 0 && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = await api.createNoteDoc({
        title: DEFAULT_QUICK_NOTE_TITLE,
        body,
      });
      setSavedNote(created);
      setBody('');
      writeStoredDraft('');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, [body, canSave]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-base">
      <div className="border-b border-border-subtle px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.625rem)]">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <Link to={COMPANION_NOTES_PATH} className="text-[12px] font-medium text-accent">← Notes</Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setBody('');
                setError(null);
                setSavedNote(null);
              }}
              disabled={saving || body.trim().length === 0}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-secondary transition-colors hover:bg-surface hover:text-primary disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => { void handleSave(); }}
              disabled={!canSave}
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-45"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3">
          {savedNote ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Saved to notes</p>
                  <p className="truncate text-[13px] text-primary">{savedNote.memory.id}</p>
                </div>
                <Link to={buildCompanionNotePath(savedNote.memory.id)} className="shrink-0 text-[12px] font-medium text-accent">Open</Link>
              </div>
            </div>
          ) : null}

          {error ? <p className="text-[13px] text-danger">Unable to save note: {error}</p> : null}

          <NoteEditorDocument
            title=""
            onTitleChange={() => {}}
            description=""
            onDescriptionChange={() => {}}
            body={body}
            onBodyChange={(nextValue) => {
              if (savedNote) {
                setSavedNote(null);
              }
              setBody(nextValue);
            }}
            showTitle={false}
            showDescription={false}
            bodyPlaceholder="Write a note…"
            frameClassName="ui-note-editor-frame-embedded"
            documentClassName="ui-note-editor-doc-embedded ui-companion-quick-note-doc"
          />
        </div>
      </div>
    </div>
  );
}
