import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef } from 'react';
import { Extension } from '@tiptap/core';
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
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import type { MentionItem } from '../../conversationMentions';
import { FieldsBlockExtension } from '../../editorExtensions/FieldsBlockExtension';
import { normalizeMarkdownValue } from '../../markdownDocument';
import { buildMentionLookup } from '../../mentionRendering';
import { buildNodeMentionHref } from '../../nodeMentionRoutes';
import { useNodeMentionItems } from '../../useNodeMentionItems';
import { cx } from '../ui';
import { RichMarkdownRenderer } from './RichMarkdownRenderer';

const RICH_EDITOR_MENTION_PATTERN = /@[\w-]+/g;
const RICH_EDITOR_MENTION_PLUGIN_KEY = new PluginKey('rich-editor-mentions');

function editorValue(value: string): string {
  return normalizeMarkdownValue(value);
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
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      FieldsBlockExtension,
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
      if (nextValue === lastValueRef.current) {
        return;
      }

      lastValueRef.current = nextValue;
      if (!currentEditor.isFocused) {
        return;
      }

      onChange(nextValue);
    },
  }, [mentionLookup, placeholder, readOnly]);

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

  return (
    <div
      className={cx(
        'ui-rich-editor',
        variant === 'panel' ? 'ui-rich-editor-panel' : 'ui-rich-editor-document',
        className,
        readOnly && 'ui-rich-editor-readonly',
      )}
    >
      <div className="ui-rich-editor-surface" onClickCapture={handleSurfaceClick}>
        <EditorContent editor={editor} className="ui-rich-editor-content" />
      </div>
    </div>
  );
}
