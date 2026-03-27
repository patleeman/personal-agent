import { type ReactNode } from 'react';
import { RichMarkdownEditor } from './editor/RichMarkdownEditor';

export function NoteEditorDocument({
  title,
  onTitleChange,
  summary,
  onSummaryChange,
  body,
  onBodyChange,
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

        <RichMarkdownEditor
          value={body}
          onChange={onBodyChange}
          placeholder={bodyPlaceholder}
          readOnly={readOnly}
          className="ui-note-rich-editor"
        />
      </div>
    </div>
  );
}
