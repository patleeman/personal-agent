import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RichMarkdownEditor } from './editor/RichMarkdownEditor';

export function NoteEditorDocument({
  title,
  onTitleChange,
  body,
  onBodyChange,
  meta,
  inferredTags,
  buildTagHref,
  titlePlaceholder = 'Untitled',
  bodyPlaceholder = 'Start writing…',
  readOnly = false,
}: {
  title: string;
  onTitleChange: (nextValue: string) => void;
  body: string;
  onBodyChange: (nextValue: string) => void;
  path: string;
  meta?: ReactNode;
  inferredTags: string[];
  buildTagHref?: (tag: string) => string;
  titlePlaceholder?: string;
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

        <div className="ui-note-inline-tags" aria-label="Inferred note tags">
          {inferredTags.map((tag) => {
            const label = `#${tag}`;
            const href = buildTagHref?.(tag);
            return href ? (
              <Link key={tag} to={href} className="ui-note-tag-link">
                {label}
              </Link>
            ) : (
              <span key={tag} className="ui-note-tag-link">
                {label}
              </span>
            );
          })}
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
