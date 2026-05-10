import { useId, useMemo, useState } from 'react';
import { stringify } from 'yaml';

import { countMarkdownFrontmatterFields, isMarkdownFrontmatterValueEmpty, type MarkdownFrontmatter } from '../lib/markdownDocument';

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function formatScalar(value: string | number | boolean | null): string {
  if (value === null) {
    return 'null';
  }

  return String(value);
}

function formatFrontmatterValue(value: unknown): { text: string; multiline: boolean } {
  if (Array.isArray(value)) {
    const scalarArray = value.every((entry) => entry === null || ['string', 'number', 'boolean'].includes(typeof entry));
    if (value.length === 0) {
      return { text: '[]', multiline: false };
    }

    if (scalarArray) {
      return {
        text: value.map((entry) => formatScalar((entry ?? null) as string | number | boolean | null)).join(', '),
        multiline: false,
      };
    }
  }

  if (value && typeof value === 'object') {
    const text = stringify(value, {
      lineWidth: 0,
      indent: 2,
      minContentWidth: 0,
    }).trimEnd();

    return {
      text,
      multiline: text.includes('\n'),
    };
  }

  return {
    text: formatScalar((value ?? null) as string | number | boolean | null),
    multiline: false,
  };
}

export function FrontmatterDisclosure({
  frontmatter,
  rawFrontmatter,
  parseError,
  onChange,
  defaultOpen = false,
}: {
  frontmatter: MarkdownFrontmatter;
  rawFrontmatter?: string | null;
  parseError?: string | null;
  onChange?: (frontmatter: MarkdownFrontmatter) => void;
  defaultOpen?: boolean;
}) {
  const contentId = useId();
  const [open, setOpen] = useState(defaultOpen || Boolean(parseError));
  const [tagInput, setTagInput] = useState('');
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const fieldCount = countMarkdownFrontmatterFields(frontmatter);
  const tags = normalizeTags(frontmatter.tags);
  const entries = useMemo(
    () => Object.entries(frontmatter).filter(([key, value]) => key !== 'tags' && !isMarkdownFrontmatterValueEmpty(value)),
    [frontmatter],
  );

  const summary = parseError ? 'Invalid YAML' : fieldCount === 0 ? 'No fields' : `${fieldCount} field${fieldCount === 1 ? '' : 's'}`;

  const showTagEditor = Boolean(onChange) || tags.length > 0;
  const trimmedNewFieldKey = newFieldKey.trim();
  const canAddField =
    Boolean(onChange) && trimmedNewFieldKey.length > 0 && trimmedNewFieldKey !== 'tags' && !(trimmedNewFieldKey in frontmatter);

  const addField = () => {
    if (!onChange || !canAddField) {
      return;
    }

    onChange({
      ...frontmatter,
      [trimmedNewFieldKey]: newFieldValue.trim(),
    });
    setNewFieldKey('');
    setNewFieldValue('');
  };

  return (
    <div className={open ? 'kb-fm-panel kb-fm-panel-open' : 'kb-fm-panel'}>
      <button
        type="button"
        className="kb-fm-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={contentId}
      >
        <span className="kb-fm-summary">
          <span className="kb-fm-toggle-label">Frontmatter</span>
          <span className="kb-fm-toggle-meta">{summary}</span>
        </span>
        <span className="kb-fm-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      {open ? (
        <div id={contentId} className="kb-fm-body">
          {parseError ? (
            <div className="kb-fm-error-wrap">
              <p className="kb-fm-error">{parseError}</p>
              {rawFrontmatter ? <pre className="kb-fm-raw">{rawFrontmatter}</pre> : null}
            </div>
          ) : (
            <table className="kb-fm-table">
              <tbody>
                {showTagEditor ? (
                  <tr>
                    <th scope="row" className="kb-fm-key">
                      tags
                    </th>
                    <td className="kb-fm-value">
                      <div className="kb-fm-tag-list">
                        {tags.map((tag) => (
                          <span key={tag} className="kb-fm-tag">
                            <span>{tag}</span>
                            {onChange ? (
                              <button
                                type="button"
                                className="kb-fm-tag-remove"
                                aria-label={`Remove tag ${tag}`}
                                onClick={() => {
                                  onChange({
                                    ...frontmatter,
                                    tags: tags.filter((entry) => entry !== tag),
                                  });
                                }}
                              >
                                ×
                              </button>
                            ) : null}
                          </span>
                        ))}
                        {onChange ? (
                          <input
                            type="text"
                            className="kb-fm-tag-input"
                            aria-label="Add frontmatter tag"
                            placeholder={tags.length > 0 ? 'Add tag…' : 'No tags yet…'}
                            value={tagInput}
                            onChange={(event) => setTagInput(event.target.value)}
                            onKeyDown={(event) => {
                              if ((event.key === 'Enter' || event.key === ',') && tagInput.trim()) {
                                event.preventDefault();
                                const nextTag = tagInput.trim().replace(/^#/, '');
                                if (nextTag.length === 0 || tags.includes(nextTag)) {
                                  setTagInput('');
                                  return;
                                }
                                onChange({
                                  ...frontmatter,
                                  tags: [...tags, nextTag],
                                });
                                setTagInput('');
                              }
                            }}
                          />
                        ) : tags.length === 0 ? (
                          <span className="kb-fm-empty">No tags</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
                {entries.map(([key, value]) => {
                  const formatted = formatFrontmatterValue(value);
                  return (
                    <tr key={key}>
                      <th scope="row" className="kb-fm-key">
                        {key}
                      </th>
                      <td className="kb-fm-value">
                        {formatted.multiline ? <pre className="kb-fm-pre">{formatted.text}</pre> : <span>{formatted.text}</span>}
                      </td>
                    </tr>
                  );
                })}
                {onChange ? (
                  <tr>
                    <th scope="row" className="kb-fm-key">
                      <input
                        type="text"
                        className="kb-fm-field-input kb-fm-field-key-input"
                        aria-label="New frontmatter field name"
                        placeholder="field"
                        value={newFieldKey}
                        onChange={(event) => setNewFieldKey(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            addField();
                          }
                        }}
                      />
                    </th>
                    <td className="kb-fm-value">
                      <div className="kb-fm-field-add-row">
                        <input
                          type="text"
                          className="kb-fm-field-input"
                          aria-label="New frontmatter field value"
                          placeholder="value"
                          value={newFieldValue}
                          onChange={(event) => setNewFieldValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              addField();
                            }
                          }}
                        />
                        <button type="button" className="kb-fm-add-field" disabled={!canAddField} onClick={addField}>
                          Add field
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {!onChange && !showTagEditor && entries.length === 0 ? (
                  <tr>
                    <th scope="row" className="kb-fm-key">
                      —
                    </th>
                    <td className="kb-fm-value">
                      <span className="kb-fm-empty">No frontmatter fields.</span>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}
