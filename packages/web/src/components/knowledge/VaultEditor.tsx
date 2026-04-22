import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { StarterKit } from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Link } from '@tiptap/extension-link';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Image } from '@tiptap/extension-image';
import { api, vaultApi } from '../../client/api';
import type { VaultBacklink, VaultEntry } from '../../shared/types';
import { parseMarkdownDocument, stringifyMarkdownFrontmatter, type MarkdownFrontmatter } from '../../knowledge/markdownDocument';
import { buildWikiLinkExtension } from './WikiLinkExtension';
import { buildWikiLinkRenderer } from './WikiLinkSuggestion';
import { emitKBEvent, onKBEvent } from './knowledgeEvents';
import { readMarkdownFromEditor } from './markdownEditorContent';
import { FrontmatterDisclosure } from './FrontmatterDisclosure';

// ── Icons ─────────────────────────────────────────────────────────────────────

function Ico({ d, size = 13 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ICON = {
  bold:     'M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z',
  italic:   'M19 4h-9M14 20H5M15 4 9 20',
  strike:   'M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16',
  code:     'm16 18 6-6-6-6M8 6l-6 6 6 6',
  quote:    'M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z',
  backlink: 'M9 15 3 9l6-6M3 9h12a6 6 0 0 1 0 12h-3',
};

function ToolbarButton({ active, onClick, title, children }: {
  active?: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button type="button" title={title} onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={['flex items-center justify-center w-7 h-7 rounded transition-colors',
        active ? 'bg-accent/20 text-accent' : 'text-secondary hover:bg-accent/10 hover:text-primary',
      ].join(' ')}>
      {children}
    </button>
  );
}

// ── Autosave ──────────────────────────────────────────────────────────────────

const AUTOSAVE_MS = 800;

function useAutosave(
  fileId: string | null,
  getContent: () => string,
  dirty: boolean,
  revision: number,
  onSaved: () => void,
  onError: (message: string | null) => void,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (!fileId || !dirty || revision <= 0) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (saving.current) return;
      saving.current = true;
      try {
        await vaultApi.writeFile(fileId, getContent());
        onSaved();
      } catch (error) {
        console.error('vault autosave failed', error);
        onError(error instanceof Error ? error.message : String(error));
      } finally {
        saving.current = false;
      }
    }, AUTOSAVE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fileId, dirty, revision, getContent, onSaved, onError]);
}

// ── Frontmatter ───────────────────────────────────────────────────────────────

type Frontmatter = MarkdownFrontmatter;

// ── Editable title ────────────────────────────────────────────────────────────

function EditableTitle({ fileName, fileId, onRenamed }: {
  fileName: string; fileId: string; onRenamed: (newId: string) => void;
}) {
  const [value, setValue] = useState(fileName);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => { setValue(fileName); }, [fileName]);

  const commit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === fileName) { setValue(fileName); setRenaming(false); return; }
    const newName = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
    try {
      const updated = await vaultApi.rename(fileId, newName);
      emitKBEvent('kb:file-renamed', { oldId: fileId, newId: updated.id });
      onRenamed(updated.id);
    } catch { setValue(fileName); }
    setRenaming(false);
  }, [value, fileName, fileId, onRenamed]);

  if (renaming) {
    return (
      <input className="kb-title-input" value={value}
        onChange={(e) => setValue(e.target.value)} autoFocus
        onBlur={() => { void commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commit(); } if (e.key === 'Escape') { setValue(fileName); setRenaming(false); } }} />
    );
  }
  return <h1 className="kb-title" onClick={() => setRenaming(true)} title="Click to rename">{fileName}</h1>;
}

// ── Backlinks panel ───────────────────────────────────────────────────────────

function BacklinksPanel({ fileId, onNavigate }: { fileId: string; onNavigate: (id: string) => void }) {
  const contentId = useId();
  const [backlinks, setBacklinks] = useState<VaultBacklink[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    setLoading(true);
    vaultApi.backlinks(fileId).then((r) => setBacklinks(r.backlinks)).catch(() => setBacklinks([]))
      .finally(() => setLoading(false));
  }, [fileId]);

  if (loading || backlinks.length === 0) return null;

  const summary = `${backlinks.length} backlink${backlinks.length !== 1 ? 's' : ''}`;

  return (
    <div className={open ? 'kb-bl-panel kb-bl-panel-open' : 'kb-bl-panel'}>
      <button
        type="button"
        className="kb-bl-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={contentId}
      >
        <span className="kb-bl-summary">
          <span className="kb-bl-toggle-label">Backlinks</span>
          <span className="kb-bl-toggle-meta">{summary}</span>
        </span>
        <span className="kb-bl-chevron" aria-hidden="true">⌄</span>
      </button>

      {open ? (
        <div id={contentId} className="kb-bl-body">
          <div className="kb-backlinks-list">
            {backlinks.map((bl) => (
              <button key={bl.id} type="button" className="kb-backlink-item" onClick={() => onNavigate(bl.id)}>
                <span className="kb-backlink-name">{bl.name.replace(/\.md$/, '')}</span>
                <span className="kb-backlink-excerpt">{bl.excerpt}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Editor ────────────────────────────────────────────────────────────────────

export interface VaultEditorProps {
  fileId: string | null;
  fileName?: string;
  onFileNavigate: (id: string) => void;
  onFileRenamed: (oldId: string, newId: string) => void;
}

export function VaultEditor({ fileId, fileName, onFileNavigate, onFileRenamed }: VaultEditorProps) {
  const [frontmatter, setFrontmatter] = useState<Frontmatter>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const currentFileId = useRef<string | null>(null);
  const fmRef = useRef<Frontmatter>({});
  const rawFrontmatterRef = useRef<string | null>(null);
  const frontmatterErrorRef = useRef<string | null>(null);
  const [frontmatterError, setFrontmatterError] = useState<string | null>(null);
  const [rawFrontmatter, setRawFrontmatter] = useState<string | null>(null);

  // Vault entries for wikilink autocomplete — refresh on kb events
  const [allEntries, setAllEntries] = useState<VaultEntry[]>([]);
  const entriesRef = useRef<VaultEntry[]>([]);
  const loadEntries = useCallback(async () => {
    try {
      const { files } = await api.vaultFiles();
      const markdownFiles = files
        .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.md'))
        .map((entry) => ({ ...entry }));
      setAllEntries(markdownFiles);
      entriesRef.current = markdownFiles;
    } catch {
      // silent
    }
  }, []);

  useEffect(() => { void loadEntries(); }, [loadEntries]);
  useEffect(() => { entriesRef.current = allEntries; }, [allEntries]);

  // Refresh entries on any KB mutation
  useEffect(() => {
    const offs = [
      onKBEvent('kb:entries-changed', () => void loadEntries()),
      onKBEvent('kb:file-created', () => void loadEntries()),
      onKBEvent('kb:file-renamed', () => void loadEntries()),
      onKBEvent('kb:file-deleted', () => void loadEntries()),
    ];
    return () => offs.forEach((off) => off());
  }, [loadEntries]);

  const suggestionRenderer = useRef(buildWikiLinkRenderer());
  const fileIdRef = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: { HTMLAttributes: { class: 'kb-code-block' } } }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: false }),
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      Image.configure({ inline: false, allowBase64: false }),
      buildWikiLinkExtension(
        () => entriesRef.current,
        onFileNavigate,
        suggestionRenderer.current,
      ),
    ],
    content: '',
    editorProps: {
      attributes: { class: 'kb-editor-content' },
      handlePaste: (view, event) => {
        // Image paste
        const items = Array.from(event.clipboardData?.items ?? []);
        const imgItem = items.find((i) => i.type.startsWith('image/'));
        if (!imgItem || !fileIdRef.current) return false;
        const blob = imgItem.getAsFile();
        if (!blob) return false;
        event.preventDefault();
        const ext = blob.type.replace('image/', '').replace('jpeg', 'jpg');
        const filename = `paste-${Date.now()}.${ext}`;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const result = await vaultApi.uploadImage(filename, reader.result as string);
            editor?.commands.setImage({ src: result.url });
          } catch (err) { console.error('image upload failed', err); }
        };
        reader.readAsDataURL(blob);
        return true;
      },
      handleDrop: (view, event) => {
        if (!fileIdRef.current) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        for (const file of files) {
          const ext = file.type.replace('image/', '').replace('jpeg', 'jpg');
          const filename = `drop-${Date.now()}.${ext}`;
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const result = await vaultApi.uploadImage(filename, reader.result as string);
              editor?.commands.setImage({ src: result.url });
            } catch (err) { console.error('image upload failed', err); }
          };
          reader.readAsDataURL(file);
        }
        return true;
      },
    },
    onUpdate: () => {
      if (!currentFileId.current) return;
      setDirty(true);
      setSaveError(null);
      setRevision((current) => current + 1);
    },
  });

  // Keep fileIdRef in sync for paste handlers
  useEffect(() => { fileIdRef.current = fileId; }, [fileId]);

  // Load file
  useEffect(() => {
    if (!fileId) {
      currentFileId.current = null;
      fileIdRef.current = null;
      editor?.commands.setContent('', { contentType: 'markdown' });
      setDirty(false);
      setError(null);
      setSaveError(null);
      setRevision(0);
      setFrontmatter({});
      setFrontmatterError(null);
      setRawFrontmatter(null);
      fmRef.current = {};
      rawFrontmatterRef.current = null;
      frontmatterErrorRef.current = null;
      return;
    }
    currentFileId.current = null;
    setLoading(true); setDirty(false); setError(null); setSaveError(null); setRevision(0);

    vaultApi.readFile(fileId)
      .then(({ content }) => {
        const { frontmatter: parsedFrontmatter, rawFrontmatter: nextRawFrontmatter, frontmatterError: nextFrontmatterError, body } = parseMarkdownDocument(content);
        const fm = parsedFrontmatter ?? {};
        setFrontmatter(fm);
        fmRef.current = fm;
        setRawFrontmatter(nextRawFrontmatter);
        rawFrontmatterRef.current = nextRawFrontmatter;
        setFrontmatterError(nextFrontmatterError);
        frontmatterErrorRef.current = nextFrontmatterError;
        if (editor) {
          editor.commands.setContent(body, { contentType: 'markdown' });
          editor.commands.focus('start');
        }
        currentFileId.current = fileId;
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [fileId, editor]);

  // Build full file content (frontmatter + body) for saving
  const getContent = useCallback(() => {
    const body = readMarkdownFromEditor(editor);
    if (frontmatterErrorRef.current && rawFrontmatterRef.current !== null) {
      return `---\n${rawFrontmatterRef.current}\n---\n\n${body.replace(/^\n+/, '')}`;
    }

    return stringifyMarkdownFrontmatter(fmRef.current, body);
  }, [editor]);

  const handleFmChange = useCallback((newFm: Frontmatter) => {
    setFrontmatter(newFm);
    fmRef.current = newFm;
    setFrontmatterError(null);
    frontmatterErrorRef.current = null;
    if (currentFileId.current) setDirty(true);
  }, []);

  const handleSaved = useCallback(() => {
    setDirty(false);
    setSaveError(null);
    setSavedAt(Date.now());
  }, []);
  useAutosave(fileId ?? null, getContent, dirty, revision, handleSaved, setSaveError);

  // ── States ────────────────────────────────────────────────────────────────

  if (!fileId) {
    return (
      <div className="flex h-full w-full flex-1 items-center justify-center px-6 text-center text-[13px] text-dim">
        Select a file to edit, or import a URL from the knowledge sidebar.
      </div>
    );
  }
  if (loading) {
    return <div className="flex h-full items-center justify-center text-dim text-[13px] animate-pulse">Loading…</div>;
  }
  if (error) {
    return <div className="flex h-full items-center justify-center text-danger text-[13px] px-8 text-center">{error}</div>;
  }

  const titleName = (fileName ?? '').replace(/\.md$/, '');
  const saveStatus = saveError ? 'Save failed' : dirty ? 'Unsaved' : savedAt ? 'Saved' : '';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
      {/* Bubble menu */}
      {editor && (
        <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}
          className="flex items-center gap-0.5 rounded-lg border border-border-default bg-elevated shadow-lg px-1.5 py-1">
          <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
            <Ico d={ICON.bold} />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
            <Ico d={ICON.italic} />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
            <Ico d={ICON.strike} />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">
            <Ico d={ICON.code} />
          </ToolbarButton>
          <div className="w-px h-4 bg-border-subtle mx-0.5 shrink-0" />
          <ToolbarButton active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="H1">
            <span className="text-[10px] font-bold leading-none">H1</span>
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="H2">
            <span className="text-[10px] font-bold leading-none">H2</span>
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">
            <Ico d={ICON.quote} />
          </ToolbarButton>
        </BubbleMenu>
      )}

      <div className="kb-editor-shell">
        <div className="kb-editor-wrapper">
          <div className="kb-file-meta" aria-label="File path">
            <span className="kb-file-path" title={fileId}>{fileId}</span>
            {saveStatus ? (
              <span className={['kb-file-status', saveError ? 'kb-file-status-error' : null].filter(Boolean).join(' ')} title={saveError ?? undefined}>
                {saveStatus}
              </span>
            ) : null}
          </div>

          <FrontmatterDisclosure
            frontmatter={frontmatter}
            rawFrontmatter={rawFrontmatter}
            parseError={frontmatterError}
            onChange={handleFmChange}
          />
          <EditableTitle
            fileName={titleName}
            fileId={fileId}
            onRenamed={(newId) => { onFileRenamed(fileId, newId); }}
          />
          <EditorContent editor={editor} />
          <BacklinksPanel fileId={fileId} onNavigate={onFileNavigate} />
        </div>
      </div>
    </div>
  );
}
