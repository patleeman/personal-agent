import { type ChangeEvent as ReactChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Extension, type JSONContent } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Table } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state';
import { EditorContent, type Editor, useEditor } from '@tiptap/react';
import { BubbleMenu, FloatingMenu } from '@tiptap/react/menus';
import { filterMentionItems, type MentionItem } from '../../conversationMentions';
import { FieldsBlockExtension } from '../../editorExtensions/FieldsBlockExtension';
import { normalizeMarkdownValue } from '../../markdownDocument';
import { buildMentionLookup } from '../../mentionRendering';
import { buildNodeMentionHref } from '../../nodeMentionRoutes';
import { useNodeMentionItems } from '../../useNodeMentionItems';
import { Pill, cx } from '../ui';
import { RichMarkdownRenderer } from './RichMarkdownRenderer';
import { exitHeadingOnEnter } from './richMarkdownHeadingExit';
import { calculateRichMarkdownMentionMenuPosition, type RichMarkdownMentionMenuPosition } from './richMarkdownMentionMenuPosition';

const RICH_EDITOR_MENTION_PATTERN = /@[\w-]+/g;
const RICH_EDITOR_MENTION_PLUGIN_KEY = new PluginKey('rich-editor-mentions');

interface EditorMentionMatch {
  query: string;
  from: number;
  to: number;
}

interface EditorSelectionRange {
  from: number;
  to: number;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

function normalizeImageAltText(fileName: string): string {
  const normalized = fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || 'Image';
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read image.'));
        return;
      }

      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

function buildImageInsertContent(images: Array<{ src: string; alt: string; title?: string }>): JSONContent[] {
  return images.flatMap((image) => [
    {
      type: 'image',
      attrs: image,
    },
    { type: 'paragraph' },
  ] satisfies JSONContent[]);
}

function currentSelectionRange(editor: Editor): EditorSelectionRange {
  return {
    from: editor.state.selection.from,
    to: editor.state.selection.to,
  };
}

function shouldShowFormattingBubbleMenu({
  editor,
  element,
  view,
  state,
  from,
  to,
}: {
  editor: Editor;
  element: HTMLElement;
  view: EditorView;
  state: EditorState;
  from: number;
  to: number;
}): boolean {
  const isChildOfMenu = typeof document !== 'undefined' && element.contains(document.activeElement);
  const hasEditorFocus = view.hasFocus() || isChildOfMenu;
  if (!hasEditorFocus || !editor.isEditable || from === to) {
    return false;
  }

  return state.doc.textBetween(from, to, ' ', ' ').trim().length > 0;
}

function shouldShowInsertFloatingMenu({
  editor,
  view,
  state,
}: {
  editor: Editor;
  view: EditorView;
  state: EditorState;
}): boolean {
  if (!view.hasFocus() || !editor.isEditable || !state.selection.empty) {
    return false;
  }

  const { $anchor } = state.selection;
  if ($anchor.depth !== 1 || !$anchor.parent.isTextblock || $anchor.parent.type.spec.code) {
    return false;
  }

  // Only show the insert menu for a truly empty document while preserving
  // no-text-selection behavior on populated documents.
  const documentText = state.doc.textBetween(0, state.doc.content.size, ' ', ' ').trim();
  if (documentText.length > 0) {
    return false;
  }

  return !$anchor.parent.textContent && $anchor.parent.childCount === 0;
}

function InlineMenuButton({
  label,
  title,
  active = false,
  onPress,
}: {
  label: string;
  title: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onPress}
      className={cx('ui-rich-editor-inline-button', active && 'ui-rich-editor-inline-button-active')}
    >
      {label}
    </button>
  );
}

function editorValue(value: string): string {
  return normalizeMarkdownValue(value);
}

function findEditorMentionMatch(editor: Editor | null): EditorMentionMatch | null {
  if (!editor) {
    return null;
  }

  const { selection } = editor.state;
  if (!selection.empty) {
    return null;
  }

  const { $from } = selection;
  if (!$from.parent.isTextblock) {
    return null;
  }

  const prefix = $from.parent.textBetween(0, $from.parentOffset, '\0', '\0');
  const match = prefix.match(/(^|.*[\s(])(@[\w-]*)$/);
  const query = match?.[2] ?? null;
  if (!query) {
    return null;
  }

  const startOffset = prefix.length - query.length;
  return {
    query,
    from: $from.start() + startOffset,
    to: selection.from,
  };
}

function buildMentionDecorations(doc: Parameters<typeof DecorationSet.create>[0], lookup: Map<string, MentionItem[]>): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, position) => {
    if (!node.isText || !node.text) {
      return;
    }

    RICH_EDITOR_MENTION_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = RICH_EDITOR_MENTION_PATTERN.exec(node.text)) !== null) {
      const mention = match[0];
      const start = match.index;
      const previous = start > 0 ? node.text[start - 1] : '';
      if (previous && /[\w./+-]/.test(previous)) {
        continue;
      }

      const matches = lookup.get(mention) ?? [];
      const resolvedItem = matches.length === 1 ? matches[0] : null;
      const href = resolvedItem ? buildNodeMentionHref(resolvedItem, 'main') : null;
      decorations.push(
        Decoration.inline(position + start, position + start + mention.length, {
          nodeName: href ? 'a' : 'span',
          class: href ? 'ui-rich-editor-mention ui-rich-editor-mention-link' : 'ui-rich-editor-mention',
          ...(href ? {
            href,
            'data-rich-editor-mention-href': href,
            rel: 'noreferrer',
            title: `Open ${mention}`,
          } : {}),
        }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

function createHeadingExitExtension(): Extension {
  return Extension.create({
    name: 'richEditorHeadingExit',
    addKeyboardShortcuts() {
      return {
        Enter: () => exitHeadingOnEnter(this.editor),
      };
    },
  });
}

function createMentionLinkExtension(lookup: Map<string, MentionItem[]>): Extension {
  return Extension.create({
    name: 'richEditorMentionLinks',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: RICH_EDITOR_MENTION_PLUGIN_KEY,
          props: {
            decorations: (state) => buildMentionDecorations(state.doc, lookup),
            handleClick: (view, _position, event) => {
              const eventTarget = event.target instanceof HTMLElement
                ? event.target
                : event.target instanceof Node
                  ? event.target.parentElement
                  : null;
              if (!eventTarget) {
                return false;
              }

              const target = eventTarget.closest<HTMLElement>('[data-rich-editor-mention-href]');
              const href = target?.dataset.richEditorMentionHref;
              if (!target || !href) {
                return false;
              }

              event.preventDefault();
              if (event.metaKey || event.ctrlKey) {
                window.open(href, '_blank', 'noopener');
              } else {
                window.location.assign(href);
              }
              return true;
            },
          },
        }),
      ];
    },
  });
}

export function RichMarkdownEditor({
  value,
  onChange,
  placeholder = 'Start writing…',
  className,
  readOnly = false,
  variant = 'document',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
  variant?: 'document' | 'panel';
}) {
  const { data: mentionItems } = useNodeMentionItems();
  const mentionLookup = useMemo(() => buildMentionLookup(mentionItems ?? []), [mentionItems]);

  if (typeof window === 'undefined') {
    return (
      <div className={cx('ui-rich-editor', variant === 'panel' ? 'ui-rich-editor-panel' : 'ui-rich-editor-document', className)}>
        <RichMarkdownRenderer content={value} emptyText={placeholder} />
      </div>
    );
  }

  const normalizedValue = useMemo(() => editorValue(value), [value]);
  const lastValueRef = useRef(normalizedValue);
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const imagePickerRef = useRef<HTMLInputElement | null>(null);
  const pendingImageInsertRangeRef = useRef<EditorSelectionRange | null>(null);
  const [mentionMatch, setMentionMatch] = useState<EditorMentionMatch | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionMenuPosition, setMentionMenuPosition] = useState<RichMarkdownMentionMenuPosition | null>(null);

  const filteredMentionItems = useMemo(
    () => mentionMatch ? filterMentionItems(mentionItems ?? [], mentionMatch.query) : [],
    [mentionItems, mentionMatch],
  );
  const showMentionMenu = !readOnly && mentionMatch !== null && filteredMentionItems.length > 0;

  const updateMentionMenuPosition = useCallback((currentEditor: Editor | null) => {
    const editorShell = editorShellRef.current;
    if (!currentEditor || !editorShell) {
      return null;
    }

    try {
      return calculateRichMarkdownMentionMenuPosition({
        containerRect: editorShell.getBoundingClientRect(),
        caretRect: currentEditor.view.coordsAtPos(currentEditor.state.selection.from),
      });
    } catch {
      return null;
    }
  }, []);

  const updateMentionState = useCallback((currentEditor: Editor | null) => {
    const nextMatch = findEditorMentionMatch(currentEditor);
    setMentionMatch(nextMatch);
    setMentionIdx(0);
    setMentionMenuPosition(nextMatch ? updateMentionMenuPosition(currentEditor) : null);
  }, [updateMentionMenuPosition]);

  function handleSurfaceClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-rich-editor-mention-href]')
      : null;
    const href = target?.dataset.richEditorMentionHref;
    if (!target || !href) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey) {
      window.open(href, '_blank', 'noopener');
    } else {
      window.location.assign(href);
    }
  }

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
      }),
      Image.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: 'ui-rich-editor-inline-image',
        },
      }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      FieldsBlockExtension,
      createHeadingExitExtension(),
      createMentionLinkExtension(mentionLookup),
      Markdown.configure({
        markedOptions: {
          gfm: true,
          breaks: true,
        },
      }),
    ],
    content: normalizedValue,
    contentType: 'markdown',
    onUpdate: ({ editor: currentEditor }) => {
      const nextValue = editorValue(currentEditor.getMarkdown());
      if (nextValue !== lastValueRef.current) {
        lastValueRef.current = nextValue;
        if (currentEditor.isFocused) {
          onChange(nextValue);
        }
      }

      updateMentionState(currentEditor);
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      updateMentionState(currentEditor);
    },
    onBlur: () => {
      setMentionMatch(null);
      setMentionIdx(0);
      setMentionMenuPosition(null);
    },
  }, [mentionLookup, onChange, placeholder, readOnly, updateMentionState]);

  const applyMention = useCallback((item: MentionItem) => {
    if (!editor || !mentionMatch) {
      return;
    }

    editor.chain().focus().insertContentAt({ from: mentionMatch.from, to: mentionMatch.to }, `${item.id} `).run();
    setMentionMatch(null);
    setMentionIdx(0);
    setMentionMenuPosition(null);
  }, [editor, mentionMatch]);

  const appendInlineMenuTo = useCallback(() => document.body, []);

  const runEditorCommand = useCallback((command: (currentEditor: Editor) => boolean) => {
    if (!editor) {
      return;
    }

    command(editor);
  }, [editor]);

  const insertImageFiles = useCallback(async (files: File[], targetRange?: EditorSelectionRange) => {
    if (!editor || files.length === 0) {
      return;
    }

    const imageFiles = files.filter(isImageFile);
    if (imageFiles.length === 0) {
      return;
    }

    try {
      const images = await Promise.all(imageFiles.map(async (file) => ({
        src: await blobToDataUrl(file),
        alt: normalizeImageAltText(file.name),
        title: file.name.trim() || undefined,
      })));

      const selectionRange = targetRange ?? currentSelectionRange(editor);
      editor.chain().focus().insertContentAt(selectionRange, buildImageInsertContent(images)).run();
    } catch (error) {
      console.error('Could not embed image in markdown editor.', error);
    }
  }, [editor]);

  const openImagePicker = useCallback(() => {
    if (!editor) {
      return;
    }

    pendingImageInsertRangeRef.current = currentSelectionRange(editor);
    imagePickerRef.current?.click();
  }, [editor]);

  const handleImageInputChange = useCallback((event: ReactChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const selectionRange = pendingImageInsertRangeRef.current ?? (editor ? currentSelectionRange(editor) : null);
    pendingImageInsertRangeRef.current = null;
    event.target.value = '';

    if (files.length === 0) {
      return;
    }

    void insertImageFiles(files, selectionRange ?? undefined);
  }, [editor, insertImageFiles]);

  const bubbleMenu = editor ? (
    <BubbleMenu
      editor={editor}
      updateDelay={0}
      shouldShow={shouldShowFormattingBubbleMenu}
      appendTo={appendInlineMenuTo}
      options={{
        strategy: 'fixed',
        placement: 'top',
        offset: 10,
      }}
    >
      <div className="ui-rich-editor-inline-menu" role="toolbar" aria-label="Text formatting">
        <InlineMenuButton label="B" title="Bold" active={editor.isActive('bold')} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleBold().run())} />
        <InlineMenuButton label="I" title="Italic" active={editor.isActive('italic')} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleItalic().run())} />
        <InlineMenuButton label="Code" title="Inline code" active={editor.isActive('code')} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleCode().run())} />
        <span className="ui-rich-editor-inline-divider" aria-hidden="true" />
        <InlineMenuButton label="H2" title="Heading" active={editor.isActive('heading', { level: 2 })} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleHeading({ level: 2 }).run())} />
        <InlineMenuButton label="List" title="Bullet list" active={editor.isActive('bulletList')} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleBulletList().run())} />
        <InlineMenuButton label="Task" title="Task list" active={editor.isActive('taskList')} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleTaskList().run())} />
        <InlineMenuButton label="Quote" title="Block quote" active={editor.isActive('blockquote')} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleBlockquote().run())} />
      </div>
    </BubbleMenu>
  ) : null;

  const floatingMenu = editor ? (
    <FloatingMenu
      editor={editor}
      updateDelay={0}
      shouldShow={shouldShowInsertFloatingMenu}
      appendTo={appendInlineMenuTo}
      options={{
        strategy: 'fixed',
        placement: 'right-start',
        offset: 12,
      }}
    >
      <div className="ui-rich-editor-inline-menu ui-rich-editor-inline-menu-insert" role="toolbar" aria-label="Insert and block formatting">
        <InlineMenuButton label="Image" title="Insert image" onPress={openImagePicker} />
        <span className="ui-rich-editor-inline-divider" aria-hidden="true" />
        <InlineMenuButton label="H2" title="Heading" active={editor.isActive('heading', { level: 2 })} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleHeading({ level: 2 }).run())} />
        <InlineMenuButton label="List" title="Bullet list" active={editor.isActive('bulletList')} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleBulletList().run())} />
        <InlineMenuButton label="Task" title="Task list" active={editor.isActive('taskList')} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleTaskList().run())} />
        <InlineMenuButton label="Quote" title="Block quote" active={editor.isActive('blockquote')} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleBlockquote().run())} />
      </div>
    </FloatingMenu>
  ) : null;

  useEffect(() => {
    if (!editor) {
      return;
    }

    const currentValue = editorValue(editor.getMarkdown());
    if (currentValue === normalizedValue) {
      lastValueRef.current = normalizedValue;
      return;
    }

    editor.commands.setContent(normalizedValue, { contentType: 'markdown' });
    lastValueRef.current = normalizedValue;
  }, [editor, normalizedValue]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor || !showMentionMenu) {
      return;
    }

    const syncPosition = () => {
      setMentionMenuPosition(updateMentionMenuPosition(editor));
    };

    syncPosition();
    window.addEventListener('resize', syncPosition);
    return () => {
      window.removeEventListener('resize', syncPosition);
    };
  }, [editor, showMentionMenu, updateMentionMenuPosition]);

  function handlePasteCapture(event: ReactClipboardEvent<HTMLDivElement>) {
    const items = Array.from(event.clipboardData.items ?? []);
    const imageFiles = items
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .flatMap((item) => {
        const file = item.getAsFile();
        return file ? [file] : [];
      });

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    void insertImageFiles(imageFiles);
  }

  function handleDropCapture(event: ReactDragEvent<HTMLDivElement>) {
    const imageFiles = Array.from(event.dataTransfer.files ?? []).filter(isImageFile);
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    const position = editor?.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
    void insertImageFiles(imageFiles, typeof position === 'number' ? { from: position, to: position } : undefined);
  }

  function handleKeyDownCapture(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!showMentionMenu) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setMentionIdx((current) => current + 1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setMentionIdx((current) => Math.max(0, current - 1));
      return;
    }

    if ((event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey) {
      const selected = filteredMentionItems[mentionIdx % filteredMentionItems.length];
      if (!selected) {
        return;
      }

      event.preventDefault();
      applyMention(selected);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setMentionMatch(null);
      setMentionIdx(0);
      setMentionMenuPosition(null);
    }
  }

  return (
    <div
      className={cx(
        'ui-rich-editor',
        variant === 'panel' ? 'ui-rich-editor-panel' : 'ui-rich-editor-document',
        className,
        readOnly && 'ui-rich-editor-readonly',
      )}
    >
      <div ref={editorShellRef} className="relative">
        <input
          ref={imagePickerRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={handleImageInputChange}
        />
        {bubbleMenu}
        {floatingMenu}
        {showMentionMenu && mentionMenuPosition ? (
          <div
            className="ui-menu-shell z-20 overflow-y-auto"
            style={{
              left: mentionMenuPosition.left,
              top: mentionMenuPosition.top,
              right: 'auto',
              bottom: 'auto',
              width: mentionMenuPosition.width,
              maxHeight: mentionMenuPosition.maxHeight,
            }}
          >
            <div className="px-3 pt-2 pb-1">
              <p className="ui-section-label">Mention</p>
            </div>
            {filteredMentionItems.map((item, index) => (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyMention(item);
                }}
                className={cx(
                  'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors',
                  index === (mentionIdx % filteredMentionItems.length)
                    ? 'bg-elevated text-primary'
                    : 'text-secondary hover:bg-elevated/50',
                )}
              >
                <Pill tone="muted">{item.kind}</Pill>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[13px] text-accent">{item.id}</p>
                  {(item.summary || (item.title && item.title !== item.label)) ? (
                    <p className="mt-0.5 truncate text-[12px] text-dim/90">{item.summary || item.title}</p>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        ) : null}

        <div
          className="ui-rich-editor-surface"
          onClickCapture={handleSurfaceClick}
          onKeyDownCapture={handleKeyDownCapture}
          onPasteCapture={handlePasteCapture}
          onDropCapture={handleDropCapture}
        >
          <EditorContent editor={editor} className="ui-rich-editor-content" />
        </div>
      </div>
    </div>
  );
}
