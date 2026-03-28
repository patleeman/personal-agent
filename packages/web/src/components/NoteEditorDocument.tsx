import { type ReactNode } from 'react';
import { RichMarkdownEditor } from './editor/RichMarkdownEditor';

export function NoteEditorDocument({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  body,
  onBodyChange,
  meta,
  titlePlaceholder = 'Untitled',
  descriptionPlaceholder = 'Tell the agent how to use this note, when to read it, or what it is for.',
  bodyPlaceholder = 'Start writing… Paste or drop images.',
  readOnly = false,
}: {
  title: string;
  onTitleChange: (nextValue: string) => void;
  description: string;
  onDescriptionChange: (nextValue: string) => void;
  body: string;
  onBodyChange: (nextValue: string) => void;
  meta?: ReactNode;
  titlePlaceholder?: string;
  descriptionPlaceholder?: string;
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

        <label className="ui-note-description-block">
          <span className="ui-note-description-label">For the agent (optional)</span>
          <textarea
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder={descriptionPlaceholder}
            className="ui-note-description-input"
            rows={2}
            readOnly={readOnly}
          />
        </label>

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
