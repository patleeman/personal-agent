import { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import { Markdown } from '@tiptap/markdown';
import { FieldsBlockExtension } from '../../editorExtensions/FieldsBlockExtension';
import { normalizeMarkdownValue } from '../../markdownDocument';
import { RichMarkdownRenderer } from './RichMarkdownRenderer';
import { ToolbarButton, cx } from '../ui';

function editorValue(value: string): string {
  return normalizeMarkdownValue(value);
}

function Toolbar({
  editor,
  readOnly,
}: {
  editor: ReturnType<typeof useEditor>;
  readOnly: boolean;
}) {
  if (!editor || readOnly) {
    return null;
  }

  const buttonClass = (active = false) => cx('ui-rich-editor-button', active && 'ui-rich-editor-button-active');

  function setLink() {
    const previousHref = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('Link URL', previousHref ?? 'https://');
    if (href === null) {
      return;
    }

    if (href.trim().length === 0) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  }

  return (
    <div className="ui-rich-editor-toolbar" role="toolbar" aria-label="Formatting">
      <ToolbarButton className={buttonClass(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold">
        Bold
      </ToolbarButton>
      <ToolbarButton className={buttonClass(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic">
        Italic
      </ToolbarButton>
      <ToolbarButton className={buttonClass(editor.isActive('strike'))} onClick={() => editor.chain().focus().toggleStrike().run()} aria-label="Strike">
        Strike
      </ToolbarButton>
      <ToolbarButton className={buttonClass(editor.isActive('code'))} onClick={() => editor.chain().focus().toggleCode().run()} aria-label="Inline code">
        Code
      </ToolbarButton>
      <ToolbarButton className={buttonClass(editor.isActive('heading', { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} aria-label="Heading 1">
        H1
      </ToolbarButton>
      <ToolbarButton className={buttonClass(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} aria-label="Heading 2">
        H2
      </ToolbarButton>
      <ToolbarButton className={buttonClass(editor.isActive('heading', { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} aria-label="Heading 3">
        H3
      </ToolbarButton>
      <ToolbarButton className={buttonClass(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bullet list">
        Bullets
      </ToolbarButton>
      <ToolbarButton className={buttonClass(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Ordered list">
        Numbers
      </ToolbarButton>
      <ToolbarButton className={buttonClass(editor.isActive('taskList'))} onClick={() => editor.chain().focus().toggleTaskList().run()} aria-label="Task list">
        Tasks
      </ToolbarButton>
      <ToolbarButton className={buttonClass(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()} aria-label="Blockquote">
        Quote
      </ToolbarButton>
      <ToolbarButton className={buttonClass(editor.isActive('codeBlock'))} onClick={() => editor.chain().focus().toggleCodeBlock().run()} aria-label="Code block">
        Code block
      </ToolbarButton>
      <ToolbarButton className={buttonClass(editor.isActive('link'))} onClick={setLink} aria-label="Link">
        Link
      </ToolbarButton>
      <ToolbarButton className={buttonClass(editor.isActive('fieldsBlock'))} onClick={() => editor.chain().focus().insertFieldsBlock().run()} aria-label="Insert fields">
        Fields
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()} aria-label="Insert table">
        Table
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().chain().focus().undo().run()} aria-label="Undo">
        Undo
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().chain().focus().redo().run()} aria-label="Redo">
        Redo
      </ToolbarButton>
    </div>
  );
}

export function RichMarkdownEditor({
  value,
  onChange,
  placeholder = 'Start writing…',
  className,
  readOnly = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
}) {
  if (typeof window === 'undefined') {
    return (
      <div className={cx('ui-rich-editor', className)}>
        <RichMarkdownRenderer content={value} emptyText={placeholder} />
      </div>
    );
  }

  const normalizedValue = useMemo(() => editorValue(value), [value]);
  const lastValueRef = useRef(normalizedValue);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
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
      onChange(nextValue);
    },
  }, [placeholder, readOnly]);

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
    <div className={cx('ui-rich-editor', className, readOnly && 'ui-rich-editor-readonly')}>
      <Toolbar editor={editor} readOnly={readOnly} />
      <div className="ui-rich-editor-surface">
        <EditorContent editor={editor} className="ui-rich-editor-content" />
      </div>
    </div>
  );
}
