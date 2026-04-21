import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { StarterKit } from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Link } from '@tiptap/extension-link';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Placeholder } from '@tiptap/extension-placeholder';
import { vaultApi } from '../../client/api';
import type { VaultBacklink, VaultEntry } from '../../shared/types';
import { buildWikiLinkExtension } from './WikiLinkExtension';
import { buildWikiLinkRenderer } from './WikiLinkSuggestion';

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
  bold:   'M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z',
  italic: 'M19 4h-9M14 20H5M15 4 9 20',
  strike: 'M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16',
  code:   'm16 18 6-6-6-6M8 6l-6 6 6 6',
  quote:  'M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z',
  link:   'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  backlink: 'M9 15 3 9l6-6M3 9h12a6 6 0 0 1 0 12h-3',
};

function ToolbarButton({ active, onClick, title, children }: {
  active?: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={[
        'flex items-center justify-center w-7 h-7 rounded transition-colors',
        active ? 'bg-accent/20 text-accent' : 'text-secondary hover:bg-accent/10 hover:text-primary',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// ── Autosave ──────────────────────────────────────────────────────────────────

const AUTOSAVE_MS = 800;

function useAutosave(fileId: string | null, getMarkdown: () => string, dirty: boolean, onSaved: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (!fileId || !dirty) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (saving.current) return;
      saving.current = true;
      try {
        await vaultApi.writeFile(fileId, getMarkdown());
        onSaved();
      } finally { saving.current = false; }
    }, AUTOSAVE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, dirty, onSaved]);
}

// ── Backlinks panel ───────────────────────────────────────────────────────────

function BacklinksPanel({ fileId, onNavigate }: { fileId: string; onNavigate: (id: string) => void }) {
  const [backlinks, setBacklinks] = useState<VaultBacklink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    vaultApi.backlinks(fileId)
      .then((r) => setBacklinks(r.backlinks))
      .catch(() => setBacklinks([]))
      .finally(() => setLoading(false));
  }, [fileId]);

  if (loading) return null;
  if (backlinks.length === 0) return null;

  return (
    <div className="kb-backlinks">
      <div className="kb-backlinks-header">
        <Ico d={ICON.backlink} size={12} />
        <span>{backlinks.length} backlink{backlinks.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="kb-backlinks-list">
        {backlinks.map((bl) => (
          <button
            key={bl.id}
            type="button"
            className="kb-backlink-item"
            onClick={() => onNavigate(bl.id)}
          >
            <span className="kb-backlink-name">{bl.name.replace(/\.md$/, '')}</span>
            <span className="kb-backlink-excerpt">{bl.excerpt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Editable title ────────────────────────────────────────────────────────────

function EditableTitle({ fileName, fileId, onRenamed }: {
  fileName: string;
  fileId: string;
  onRenamed: (newId: string) => void;
}) {
  const [value, setValue] = useState(fileName);
  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync when file changes
  useEffect(() => { setValue(fileName); }, [fileName]);

  const commit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === fileName) {
      setValue(fileName);
      setRenaming(false);
      return;
    }
    const newName = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
    try {
      const updated = await vaultApi.rename(fileId, newName);
      onRenamed(updated.id);
    } catch {
      setValue(fileName);
    }
    setRenaming(false);
  }, [value, fileName, fileId, onRenamed]);

  if (renaming) {
    return (
      <input
        ref={inputRef}
        className="kb-title-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { void commit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit(); }
          if (e.key === 'Escape') { setValue(fileName); setRenaming(false); }
        }}
        autoFocus
      />
    );
  }

  return (
    <h1
      className="kb-title"
      onClick={() => setRenaming(true)}
      title="Click to rename"
    >
      {fileName}
    </h1>
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const currentFileId = useRef<string | null>(null);

  // Vault entries for wikilink autocomplete
  const [allEntries, setAllEntries] = useState<VaultEntry[]>([]);
  useEffect(() => {
    vaultApi.tree().then((r) => setAllEntries(r.entries)).catch(() => {});
  }, []);
  const entriesRef = useRef(allEntries);
  useEffect(() => { entriesRef.current = allEntries; }, [allEntries]);

  // Stable renderer — created once
  const suggestionRenderer = useRef(buildWikiLinkRenderer());

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'kb-code-block' } },
      }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: false }),
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      buildWikiLinkExtension(
        () => entriesRef.current,
        onFileNavigate,
        suggestionRenderer.current,
      ),
    ],
    content: '',
    editorProps: { attributes: { class: 'kb-editor-content' } },
    onUpdate: () => { if (currentFileId.current) setDirty(true); },
  });

  // Load file when fileId changes
  useEffect(() => {
    if (!fileId) {
      currentFileId.current = null;
      editor?.commands.setContent('', { contentType: 'markdown' });
      setError(null);
      return;
    }

    currentFileId.current = null;
    setLoading(true);
    setDirty(false);
    setError(null);

    vaultApi.readFile(fileId)
      .then(({ content }) => {
        setError(null);
        if (editor) {
          editor.commands.setContent(content, { contentType: 'markdown' });
          editor.commands.focus('start');
        }
        currentFileId.current = fileId;
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const getMarkdown = useCallback(() => editor?.storage.markdown.getMarkdown() as string ?? '', [editor]);
  const handleSaved = useCallback(() => { setDirty(false); setSavedAt(Date.now()); }, []);
  useAutosave(fileId ?? null, getMarkdown, dirty, handleSaved);

  const titleName = fileName?.replace(/\.md$/, '') ?? '';

  // ── Empty / loading / error states ────────────────────────────────────────

  if (!fileId) {
    return (
      <div className="flex h-full items-center justify-center text-dim text-[13px]">
        Select a file to edit
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-dim text-[13px] animate-pulse">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-danger text-[13px] px-8 text-center">
        {error}
      </div>
    );
  }

  // ── Main editor layout ────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Save status bar */}
      <div className="flex items-center gap-2 px-6 py-1.5 shrink-0 border-b border-border-subtle">
        <span className="text-[11px] text-dim truncate font-mono">{fileId}</span>
        <span className="ml-auto text-[11px] text-dim shrink-0">
          {dirty ? 'Unsaved' : savedAt ? 'Saved' : ''}
        </span>
      </div>

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
          <ToolbarButton active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
            <span className="text-[10px] font-bold leading-none">H1</span>
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
            <span className="text-[10px] font-bold leading-none">H2</span>
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">
            <Ico d={ICON.quote} />
          </ToolbarButton>
        </BubbleMenu>
      )}

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="kb-editor-wrapper">
          {/* Editable title */}
          <EditableTitle
            fileName={titleName}
            fileId={fileId}
            onRenamed={(newId) => onFileRenamed(fileId, newId)}
          />

          {/* TipTap content */}
          <EditorContent editor={editor} />

          {/* Backlinks */}
          <BacklinksPanel fileId={fileId} onNavigate={onFileNavigate} />
        </div>
      </div>
    </div>
  );
}
