import type { VaultBacklink, VaultEntry } from '@personal-agent/extensions/data';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { StarterKit } from '@tiptap/starter-kit';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { knowledgeApi } from '../lib/knowledgeApi';
import { type MarkdownFrontmatter, parseMarkdownDocument, stringifyMarkdownFrontmatter } from '../lib/markdownDocument';
import { FrontmatterDisclosure } from './FrontmatterDisclosure';
import { emitKBEvent, type KBFileChangedExternallyDetail, onKBEvent } from './knowledgeEvents';
import { readMarkdownFromEditor } from './markdownEditorContent';
import { buildWikiLinkExtension } from './WikiLinkExtension';
import { buildWikiLinkRenderer } from './WikiLinkSuggestion';

// ── Icons ─────────────────────────────────────────────────────────────────────

function Ico({ d, size = 13 }: { d: string; size?: number }) {
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

const ICON = {
  bold: 'M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z',
  italic: 'M19 4h-9M14 20H5M15 4 9 20',
  strike: 'M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16',
  code: 'm16 18 6-6-6-6M8 6l-6 6 6 6',
  quote:
    'M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z',
  backlink: 'M9 15 3 9l6-6M3 9h12a6 6 0 0 1 0 12h-3',
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
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
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
const MAX_CACHED_VAULT_DOCUMENTS = 24;

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
        await knowledgeApi.writeFile(fileId, getContent());
        onSaved();
      } catch (error) {
        console.error('vault autosave failed', error);
        onError(error instanceof Error ? error.message : String(error));
        window.dispatchEvent(new CustomEvent('pa-notification', { detail: { type: 'warning', message: 'Vault autosave failed', details: error instanceof Error ? error.message : String(error), source: 'system-knowledge' } }));
      } finally {
        saving.current = false;
      }
    }, AUTOSAVE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fileId, dirty, revision, getContent, onSaved, onError]);
}

interface CachedVaultDocument {
  body: string;
  frontmatter: Frontmatter;
  rawFrontmatter: string | null;
  frontmatterError: string | null;
}

const cachedVaultDocuments = new Map<string, CachedVaultDocument>();
const pendingVaultDocumentReads = new Map<string, Promise<CachedVaultDocument>>();
const cachedVaultBacklinks = new Map<string, VaultBacklink[]>();
const pendingVaultBacklinkReads = new Map<string, Promise<VaultBacklink[]>>();

function rememberCachedValue<T>(cache: Map<string, T>, key: string, value: T) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);

  while (cache.size > MAX_CACHED_VAULT_DOCUMENTS) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
}

function readCachedVaultDocument(fileId: string): CachedVaultDocument | null {
  const cached = cachedVaultDocuments.get(fileId);
  if (!cached) {
    return null;
  }

  rememberCachedValue(cachedVaultDocuments, fileId, cached);
  return cached;
}

function cacheVaultDocument(fileId: string, document: CachedVaultDocument) {
  rememberCachedValue(cachedVaultDocuments, fileId, document);
}

async function loadVaultDocument(fileId: string): Promise<CachedVaultDocument> {
  const cached = readCachedVaultDocument(fileId);
  if (cached) {
    return cached;
  }

  const pending = pendingVaultDocumentReads.get(fileId);
  if (pending) {
    return pending;
  }

  const request = knowledgeApi
    .readFile(fileId)
    .then(({ content }) => {
      const { frontmatter, rawFrontmatter, frontmatterError, body } = parseMarkdownDocument(content);
      const document = {
        body,
        frontmatter: frontmatter ?? {},
        rawFrontmatter,
        frontmatterError,
      } satisfies CachedVaultDocument;
      cacheVaultDocument(fileId, document);
      return document;
    })
    .finally(() => {
      if (pendingVaultDocumentReads.get(fileId) === request) {
        pendingVaultDocumentReads.delete(fileId);
      }
    });

  pendingVaultDocumentReads.set(fileId, request);
  return request;
}

function readCachedBacklinks(fileId: string): VaultBacklink[] | null {
  const cached = cachedVaultBacklinks.get(fileId);
  if (!cached) {
    return null;
  }

  rememberCachedValue(cachedVaultBacklinks, fileId, cached);
  return [...cached];
}

function cacheBacklinks(fileId: string, backlinks: readonly VaultBacklink[]) {
  rememberCachedValue(cachedVaultBacklinks, fileId, [...backlinks]);
}

async function loadVaultBacklinks(fileId: string): Promise<VaultBacklink[]> {
  const cached = readCachedBacklinks(fileId);
  if (cached) {
    return cached;
  }

  const pending = pendingVaultBacklinkReads.get(fileId);
  if (pending) {
    return pending;
  }

  const request = knowledgeApi
    .backlinks(fileId)
    .then(({ backlinks }) => {
      cacheBacklinks(fileId, backlinks);
      return [...backlinks];
    })
    .finally(() => {
      if (pendingVaultBacklinkReads.get(fileId) === request) {
        pendingVaultBacklinkReads.delete(fileId);
      }
    });

  pendingVaultBacklinkReads.set(fileId, request);
  return request;
}

function moveCachedVaultDocument(oldId: string, newId: string) {
  const cached = cachedVaultDocuments.get(oldId);
  if (cached) {
    cachedVaultDocuments.delete(oldId);
    cacheVaultDocument(newId, cached);
  }

  pendingVaultDocumentReads.delete(oldId);
  cachedVaultBacklinks.delete(oldId);
  cachedVaultBacklinks.delete(newId);
  pendingVaultBacklinkReads.delete(oldId);
  pendingVaultBacklinkReads.delete(newId);
}

// ── Frontmatter ───────────────────────────────────────────────────────────────

type Frontmatter = MarkdownFrontmatter;

// ── Editable title ────────────────────────────────────────────────────────────

function EditableTitle({ fileName, fileId, onRenamed }: { fileName: string; fileId: string; onRenamed: (newId: string) => void }) {
  const [value, setValue] = useState(fileName);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => {
    setValue(fileName);
  }, [fileName]);

  const commit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === fileName) {
      setValue(fileName);
      setRenaming(false);
      return;
    }
    const newName = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
    try {
      const updated = await knowledgeApi.rename(fileId, newName);
      moveCachedVaultDocument(fileId, updated.id);
      emitKBEvent('kb:file-renamed', { oldId: fileId, newId: updated.id });
      onRenamed(updated.id);
    } catch {
      setValue(fileName);
    }
    setRenaming(false);
  }, [value, fileName, fileId, onRenamed]);

  if (renaming) {
    return (
      <input
        className="kb-title-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        onBlur={() => {
          void commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          }
          if (e.key === 'Escape') {
            setValue(fileName);
            setRenaming(false);
          }
        }}
      />
    );
  }
  return (
    <h1 className="kb-title" onClick={() => setRenaming(true)} title="Click to rename">
      {fileName}
    </h1>
  );
}

// ── Backlinks panel ───────────────────────────────────────────────────────────

function BacklinksPanel({ fileId, onNavigate }: { fileId: string; onNavigate: (id: string) => void }) {
  const contentId = useId();
  const [backlinks, setBacklinks] = useState<VaultBacklink[]>(() => readCachedBacklinks(fileId) ?? []);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(() => readCachedBacklinks(fileId) !== null);
  const [open, setOpen] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    setOpen(false);
    setLoading(false);
    const cached = readCachedBacklinks(fileId);
    setBacklinks(cached ?? []);
    setLoaded(cached !== null);
  }, [fileId]);

  const ensureBacklinksLoaded = useCallback(async () => {
    const cached = readCachedBacklinks(fileId);
    if (cached) {
      setBacklinks(cached);
      setLoaded(true);
      setLoading(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const nextBacklinks = await loadVaultBacklinks(fileId);
      if (requestIdRef.current !== requestId) {
        return;
      }
      setBacklinks(nextBacklinks);
      setLoaded(true);
    } catch {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setBacklinks([]);
      setLoaded(true);
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [fileId]);

  const summary = loading
    ? 'Loading backlinks…'
    : loaded
      ? `${backlinks.length} backlink${backlinks.length !== 1 ? 's' : ''}`
      : 'Load backlinks';

  return (
    <div className={open ? 'kb-bl-panel kb-bl-panel-open' : 'kb-bl-panel'}>
      <button
        type="button"
        className="kb-bl-toggle"
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          if (nextOpen) {
            void ensureBacklinksLoaded();
          }
        }}
        aria-expanded={open}
        aria-controls={contentId}
      >
        <span className="kb-bl-summary">
          <span className="kb-bl-toggle-label">Backlinks</span>
          <span className="kb-bl-toggle-meta">{summary}</span>
        </span>
        <span className="kb-bl-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>

      {open ? (
        <div id={contentId} className="kb-bl-body">
          {loading ? (
            <p className="kb-backlink-excerpt">Loading backlinks…</p>
          ) : backlinks.length === 0 ? (
            <p className="kb-backlink-excerpt">No backlinks yet.</p>
          ) : (
            <div className="kb-backlinks-list">
              {backlinks.map((bl) => (
                <button key={bl.id} type="button" className="kb-backlink-item" onClick={() => onNavigate(bl.id)}>
                  <span className="kb-backlink-name">{bl.name.replace(/\.md$/, '')}</span>
                  <span className="kb-backlink-excerpt">{bl.excerpt}</span>
                </button>
              ))}
            </div>
          )}
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
  const loadRequestIdRef = useRef(0);
  const fmRef = useRef<Frontmatter>({});
  const rawFrontmatterRef = useRef<string | null>(null);
  const frontmatterErrorRef = useRef<string | null>(null);
  const [frontmatterError, setFrontmatterError] = useState<string | null>(null);
  const [rawFrontmatter, setRawFrontmatter] = useState<string | null>(null);

  // Trigger a reload when the file changes externally
  const [reloadCounter, setReloadCounter] = useState(0);

  // Vault entries for wikilink autocomplete — refresh on kb events
  const [allEntries, setAllEntries] = useState<VaultEntry[]>([]);
  const entriesRef = useRef<VaultEntry[]>([]);
  const loadEntries = useCallback(async () => {
    try {
      const { files } = await knowledgeApi.listFiles();
      const markdownFiles = files.filter((entry) => entry.kind === 'file' && entry.name.endsWith('.md')).map((entry) => ({ ...entry }));
      setAllEntries(markdownFiles);
      entriesRef.current = markdownFiles;
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);
  useEffect(() => {
    entriesRef.current = allEntries;
  }, [allEntries]);

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

  // Cooldown to ignore external change events that are just our own save bouncing back
  const EXTERNAL_CHANGE_COOLDOWN_MS = 1500;
  const lastOwnSaveRef = useRef(0);

  // Reload the current file when it changes externally
  useEffect(() => {
    const off = onKBEvent<KBFileChangedExternallyDetail>('kb:file-changed-externally', ({ path }) => {
      if (path === fileIdRef.current && fileIdRef.current) {
        // Ignore events that arrived shortly after our own save — they're our writes bouncing back
        if (Date.now() - lastOwnSaveRef.current < EXTERNAL_CHANGE_COOLDOWN_MS) {
          return;
        }
        // Clear the cached document so the load effect re-fetches
        cachedVaultDocuments.delete(fileIdRef.current);
        pendingVaultDocumentReads.delete(fileIdRef.current);
        cachedVaultBacklinks.delete(fileIdRef.current);
        pendingVaultBacklinkReads.delete(fileIdRef.current);
        setReloadCounter((c) => c + 1);
      }
    });
    return off;
  }, []);

  const suggestionRenderer = useRef(buildWikiLinkRenderer());
  const fileIdRef = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: { HTMLAttributes: { class: 'kb-code-block' } }, link: false }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: false }),
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      Image.configure({ inline: false, allowBase64: false }),
      buildWikiLinkExtension(() => entriesRef.current, onFileNavigate, suggestionRenderer.current),
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
            const result = await knowledgeApi.uploadImage(filename, reader.result as string);
            editor?.commands.setImage({ src: result.url });
          } catch (err) {
            console.error('image upload failed', err);
            window.dispatchEvent(new CustomEvent('pa-notification', { detail: { type: 'error', message: 'Image upload failed', details: err instanceof Error ? err.message : String(err), source: 'system-knowledge' } }));
          }
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
              const result = await knowledgeApi.uploadImage(filename, reader.result as string);
              editor?.commands.setImage({ src: result.url });
            } catch (err) {
              console.error('image upload failed', err);
              window.dispatchEvent(new CustomEvent('pa-notification', { detail: { type: 'error', message: 'Image upload failed', details: err instanceof Error ? err.message : String(err), source: 'system-knowledge' } }));
            }
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

  const applyLoadedDocument = useCallback(
    (nextFileId: string, nextDocument: CachedVaultDocument) => {
      currentFileId.current = null;
      setFrontmatter(nextDocument.frontmatter);
      fmRef.current = nextDocument.frontmatter;
      setRawFrontmatter(nextDocument.rawFrontmatter);
      rawFrontmatterRef.current = nextDocument.rawFrontmatter;
      setFrontmatterError(nextDocument.frontmatterError);
      frontmatterErrorRef.current = nextDocument.frontmatterError;
      if (editor) {
        editor.commands.setContent(nextDocument.body, { contentType: 'markdown' });
        editor.commands.focus('start');
      }
      currentFileId.current = nextFileId;
    },
    [editor],
  );

  // Keep fileIdRef in sync for paste handlers
  useEffect(() => {
    fileIdRef.current = fileId;
  }, [fileId]);

  // Load file
  useEffect(() => {
    loadRequestIdRef.current += 1;

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
      setLoading(false);
      return;
    }

    const requestId = loadRequestIdRef.current;
    currentFileId.current = null;
    setLoading(true);
    setDirty(false);
    setError(null);
    setSaveError(null);
    setRevision(0);

    const cached = readCachedVaultDocument(fileId);
    if (cached) {
      applyLoadedDocument(fileId, cached);
      setLoading(false);
      return;
    }

    loadVaultDocument(fileId)
      .then((nextDocument) => {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        applyLoadedDocument(fileId, nextDocument);
      })
      .catch((err: unknown) => {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (loadRequestIdRef.current === requestId) {
          setLoading(false);
        }
      });
  }, [applyLoadedDocument, editor, fileId, reloadCounter]);

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
    if (fileId) {
      cacheVaultDocument(fileId, {
        body: readMarkdownFromEditor(editor),
        frontmatter: fmRef.current,
        rawFrontmatter: rawFrontmatterRef.current,
        frontmatterError: frontmatterErrorRef.current,
      });
    }
    setDirty(false);
    setSaveError(null);
    setSavedAt(Date.now());
    lastOwnSaveRef.current = Date.now();
    emitKBEvent('kb:content-saved');
  }, [editor, fileId]);
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
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 100 }}
          className="flex items-center gap-0.5 rounded-lg border border-border-default bg-elevated shadow-lg px-1.5 py-1"
        >
          <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
            <Ico d={ICON.bold} />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
            <Ico d={ICON.italic} />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
          >
            <Ico d={ICON.strike} />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">
            <Ico d={ICON.code} />
          </ToolbarButton>
          <div className="w-px h-4 bg-border-subtle mx-0.5 shrink-0" />
          <ToolbarButton
            active={editor.isActive('heading', { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            title="H1"
          >
            <span className="text-[10px] font-bold leading-none">H1</span>
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title="H2"
          >
            <span className="text-[10px] font-bold leading-none">H2</span>
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Blockquote"
          >
            <Ico d={ICON.quote} />
          </ToolbarButton>
        </BubbleMenu>
      )}

      <div className="kb-editor-shell">
        <div className="kb-editor-wrapper">
          <div className="kb-file-meta" aria-label="File path">
            <span className="kb-file-path" title={fileId}>
              {fileId}
            </span>
            {saveStatus ? (
              <span
                className={['kb-file-status', saveError ? 'kb-file-status-error' : null].filter(Boolean).join(' ')}
                title={saveError ?? undefined}
              >
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
            onRenamed={(newId) => {
              onFileRenamed(fileId, newId);
            }}
          />
          <EditorContent editor={editor} />
          <BacklinksPanel fileId={fileId} onNavigate={onFileNavigate} />
        </div>
      </div>
    </div>
  );
}
