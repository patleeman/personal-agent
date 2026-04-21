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

// ── Toolbar icons ─────────────────────────────────────────────────────────────

function Ico({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const TOOLBAR_ICONS = {
  bold:   'M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z',
  italic: 'M19 4h-9M14 20H5M15 4 9 20',
  strike: 'M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16',
  code:   'm16 18 6-6-6-6M8 6l-6 6 6 6',
  link:   'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  h1:     'M4 12h8M4 6v12 M20 6v12 M16 6l6 6-6 6',
  h2:     'M4 12h8M4 6v12 M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1',
  quote:  'M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z',
};

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={[
        'flex items-center justify-center w-7 h-7 rounded transition-colors',
        active
          ? 'bg-accent/20 text-accent'
          : 'text-secondary hover:bg-accent/10 hover:text-primary',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// ── Autosave hook ─────────────────────────────────────────────────────────────

const AUTOSAVE_DELAY_MS = 800;

function useAutosave(
  fileId: string | null,
  getMarkdown: () => string,
  dirty: boolean,
  onSaved: () => void,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (!fileId || !dirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (saving.current) return;
      saving.current = true;
      try {
        await vaultApi.writeFile(fileId, getMarkdown());
        onSaved();
      } finally {
        saving.current = false;
      }
    }, AUTOSAVE_DELAY_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // intentionally omit getMarkdown from deps — it's a stable ref callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, dirty, onSaved]);
}

// ── Editor component ──────────────────────────────────────────────────────────

export interface VaultEditorProps {
  fileId: string | null;
  fileName?: string;
}

export function VaultEditor({ fileId, fileName }: VaultEditorProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const currentFileId = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'kb-code-block' } },
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: false,
      }),
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'kb-editor-content',
      },
    },
    onUpdate: () => {
      if (currentFileId.current) setDirty(true);
    },
  });

  // Load file when fileId changes
  useEffect(() => {
    if (!fileId) {
      setContent(null);
      setError(null);
      editor?.commands.setContent('', { contentType: 'markdown' });
      currentFileId.current = null;
      return;
    }

    currentFileId.current = null;
    setLoading(true);
    setDirty(false);
    setError(null);

    vaultApi.readFile(fileId)
      .then(({ content: raw }) => {
        setContent(raw);
        setError(null);
        if (editor) {
          editor.commands.setContent(raw, { contentType: 'markdown' });
          // Move cursor to start
          editor.commands.focus('start');
        }
        currentFileId.current = fileId;
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const getMarkdown = useCallback(() => {
    if (!editor) return '';
    return editor.storage.markdown.getMarkdown() as string;
  }, [editor]);

  const handleSaved = useCallback(() => {
    setDirty(false);
    setSavedAt(Date.now());
  }, []);

  useAutosave(fileId ?? null, getMarkdown, dirty, handleSaved);

  // ── Empty state ───────────────────────────────────────────────────────────

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

  // ── Editor ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb + save status */}
      <div className="flex items-center gap-2 px-6 py-2.5 shrink-0 border-b border-border-subtle">
        <span className="text-[12px] text-secondary truncate font-medium">
          {fileName ?? fileId}
        </span>
        <span className="ml-auto text-[11px] text-dim shrink-0">
          {dirty ? 'Unsaved' : savedAt ? 'Saved' : ''}
        </span>
      </div>

      {/* Floating bubble toolbar */}
      {editor && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 100 }}
          className="flex items-center gap-0.5 rounded-lg border border-border-default bg-elevated shadow-lg px-1.5 py-1"
        >
          <ToolbarButton
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold"
          >
            <Ico d={TOOLBAR_ICONS.bold} size={13} />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic"
          >
            <Ico d={TOOLBAR_ICONS.italic} size={13} />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
          >
            <Ico d={TOOLBAR_ICONS.strike} size={13} />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('code')}
            onClick={() => editor.chain().focus().toggleCode().run()}
            title="Inline code"
          >
            <Ico d={TOOLBAR_ICONS.code} size={13} />
          </ToolbarButton>
          <div className="w-px h-4 bg-border-subtle mx-0.5 shrink-0" />
          <ToolbarButton
            active={editor.isActive('heading', { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            title="Heading 1"
          >
            <span className="text-[10px] font-bold leading-none">H1</span>
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title="Heading 2"
          >
            <span className="text-[10px] font-bold leading-none">H2</span>
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Blockquote"
          >
            <Ico d={TOOLBAR_ICONS.quote} size={13} />
          </ToolbarButton>
        </BubbleMenu>
      )}

      {/* Editor content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="kb-editor-wrapper">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
