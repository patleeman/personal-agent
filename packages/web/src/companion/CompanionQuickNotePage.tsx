import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { MemoryDocDetail } from '../types';
import { buildCompanionNotePath, COMPANION_NOTES_PATH } from './routes';

const COMPANION_QUICK_NOTE_DRAFT_STORAGE_KEY = 'pa-companion-quick-note-draft';
const MAX_DERIVED_NOTE_TITLE_LENGTH = 80;

function normalizeQuickNoteText(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function stripMarkdownTitleCandidate(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`>#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveCompanionQuickNoteDraft(rawText: string): { title: string; body: string } {
  const normalized = normalizeQuickNoteText(rawText).trim();
  if (!normalized) {
    return { title: '', body: '' };
  }

  const lines = normalized.split('\n');
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) {
    return { title: '', body: '' };
  }

  const firstLine = lines[firstContentIndex] ?? '';
  const title = stripMarkdownTitleCandidate(firstLine).slice(0, MAX_DERIVED_NOTE_TITLE_LENGTH).trim();
  if (!title) {
    return {
      title: normalized.slice(0, MAX_DERIVED_NOTE_TITLE_LENGTH).trim(),
      body: normalized,
    };
  }

  const remainingBody = lines
    .filter((_, index) => index !== firstContentIndex)
    .join('\n')
    .trim();

  return {
    title,
    body: remainingBody.length > 0 ? remainingBody : normalized,
  };
}

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
  const [text, setText] = useState(() => readStoredDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<MemoryDocDetail | null>(null);

  const draft = useMemo(() => deriveCompanionQuickNoteDraft(text), [text]);
  const canSave = draft.title.trim().length > 0 && draft.body.trim().length > 0 && !saving;

  useEffect(() => {
    writeStoredDraft(text);
  }, [text]);

  const handleSave = useCallback(async () => {
    if (!canSave) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = await api.createNoteDoc({
        title: draft.title,
        body: draft.body,
      });
      setSavedNote(created);
      setText('');
      writeStoredDraft('');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, [canSave, draft.body, draft.title]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border-subtle bg-base/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.85rem)]">
          <div className="flex items-center justify-between gap-3">
            <Link to={COMPANION_NOTES_PATH} className="text-[12px] font-medium text-accent">← Notes</Link>
            <button
              type="button"
              onClick={() => {
                setText('');
                setError(null);
                setSavedNote(null);
              }}
              disabled={saving || text.trim().length === 0}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
            >
              Clear
            </button>
          </div>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">assistant companion</p>
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight text-primary">Quick note</h1>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-secondary">
            Capture something fast from your phone. The first line becomes the note title automatically.
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
          {savedNote ? (
            <div className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Saved</p>
              <p className="mt-2 text-[15px] font-medium text-primary">{savedNote.memory.title}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
                <Link to={buildCompanionNotePath(savedNote.memory.id)} className="font-medium text-accent">Open note</Link>
                <Link to={COMPANION_NOTES_PATH} className="text-secondary transition-colors hover:text-primary">Back to notes</Link>
              </div>
            </div>
          ) : null}

          <div className="rounded-[28px] border border-border-subtle bg-surface/80 px-4 py-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim/70">Note</span>
              <textarea
                value={text}
                onChange={(event) => {
                  if (savedNote) {
                    setSavedNote(null);
                  }
                  setText(event.target.value);
                }}
                autoFocus
                placeholder={"Trip ideas\nBook the train for Friday morning.\nCheck hotel near the venue."}
                className="mt-3 min-h-[15rem] w-full resize-y rounded-[22px] border border-border-subtle bg-base px-4 py-4 text-[15px] leading-7 text-primary outline-none transition focus:border-accent"
              />
            </label>

            <div className="mt-4 rounded-[20px] bg-base/80 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim/70">Will save as</p>
              <p className="mt-2 text-[15px] font-medium text-primary">
                {draft.title || 'Start typing to generate a title'}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-secondary">
                {draft.body.trim().length > 0
                  ? 'Everything after the first line stays in the note body.'
                  : 'Add a few lines if you want a title plus body.'}
              </p>
            </div>

            {error ? <p className="mt-4 text-[13px] text-danger">Unable to save note: {error}</p> : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { void handleSave(); }}
                disabled={!canSave}
                className="inline-flex items-center rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-45"
              >
                {saving ? 'Saving…' : 'Save note'}
              </button>
              <Link
                to={COMPANION_NOTES_PATH}
                className="inline-flex items-center rounded-full border border-border-default px-4 py-2 text-[13px] font-medium text-secondary transition-colors hover:text-primary"
              >
                Browse notes
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
