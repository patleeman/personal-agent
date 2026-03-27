import { useMemo, type ReactNode } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { EditorView, placeholder as codeMirrorPlaceholder } from '@codemirror/view';
import { useTheme } from '../theme';
import { editorChromeTheme, languageExtensionForPath } from '../workspaceBrowser';

const noteEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    fontFamily: '"DM Sans Variable", "DM Sans", system-ui, sans-serif',
    lineHeight: '1.8',
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    minHeight: '20rem',
    padding: '0 0 18rem',
    maxWidth: '48rem',
    margin: '0 auto',
    fontSize: '15px',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgb(var(--color-accent) / 0.14)',
  },
  '.cm-placeholder': {
    color: 'rgb(var(--color-dim))',
  },
});

export function NoteEditorDocument({
  title,
  onTitleChange,
  summary,
  onSummaryChange,
  body,
  onBodyChange,
  path,
  meta,
  inferredTags,
  titlePlaceholder = 'Untitled',
  summaryPlaceholder = 'Optional one-line summary for search and browsing.',
  bodyPlaceholder = 'Start writing…',
  readOnly = false,
}: {
  title: string;
  onTitleChange: (nextValue: string) => void;
  summary: string;
  onSummaryChange: (nextValue: string) => void;
  body: string;
  onBodyChange: (nextValue: string) => void;
  path: string;
  meta?: ReactNode;
  inferredTags: string[];
  titlePlaceholder?: string;
  summaryPlaceholder?: string;
  bodyPlaceholder?: string;
  readOnly?: boolean;
}) {
  const { theme } = useTheme();
  const editorExtensions = useMemo(() => {
    const extensions: Extension[] = [
      editorChromeTheme(theme === 'dark'),
      noteEditorTheme,
      EditorView.lineWrapping,
      codeMirrorPlaceholder(bodyPlaceholder),
    ];
    const languageExtension = languageExtensionForPath(path);
    if (languageExtension) {
      extensions.push(languageExtension);
    }
    return extensions;
  }, [bodyPlaceholder, path, theme]);

  return (
    <div className="ui-note-editor-frame">
      <div className="ui-note-editor-doc">
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={titlePlaceholder}
          className="ui-note-title-input"
          autoComplete="off"
          spellCheck={false}
          readOnly={readOnly}
        />

        {meta ? <div className="ui-note-inline-meta">{meta}</div> : null}

        <div className="ui-note-properties" aria-label="Note properties">
          <div className="ui-note-property-row">
            <span className="ui-note-property-label">Summary</span>
            <input
              value={summary}
              onChange={(event) => onSummaryChange(event.target.value)}
              placeholder={summaryPlaceholder}
              className="ui-note-property-input"
              autoComplete="off"
              spellCheck
              readOnly={readOnly}
            />
          </div>
          <div className="ui-note-property-row">
            <span className="ui-note-property-label">Tags</span>
            <div className="ui-note-property-value">
              {inferredTags.length > 0
                ? inferredTags.map((tag) => `#${tag}`).join(' · ')
                : 'Inline tags are inferred from the note body. Use #tag while writing.'}
            </div>
          </div>
        </div>

        <div className="ui-note-editor-shell">
          <CodeMirror
            value={body}
            onChange={onBodyChange}
            extensions={editorExtensions}
            editable={!readOnly}
            readOnly={readOnly}
            className="h-full"
          />
        </div>
      </div>
    </div>
  );
}
