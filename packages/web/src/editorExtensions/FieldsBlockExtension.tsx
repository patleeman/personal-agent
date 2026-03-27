import { Node, type CommandProps, type NodeViewProps } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';

export interface FieldsBlockItem {
  key: string;
  value: string;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function parseFieldsBlockItems(value: string): FieldsBlockItem[] {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex < 0) {
        return { key: line, value: '' } satisfies FieldsBlockItem;
      }

      return {
        key: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      } satisfies FieldsBlockItem;
    })
    .filter((item) => item.key.length > 0 || item.value.length > 0);
}

export function serializeFieldsBlockItems(items: FieldsBlockItem[]): string {
  return items
    .map((item) => ({
      key: readString(item.key).trim(),
      value: readString(item.value).trim(),
    }))
    .filter((item) => item.key.length > 0 || item.value.length > 0)
    .map((item) => `${item.key}: ${item.value}`.trimEnd())
    .join('\n');
}

function normalizeItems(value: unknown): FieldsBlockItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const key = readString((item as { key?: unknown }).key).trim();
    const fieldValue = readString((item as { value?: unknown }).value).trim();
    if (key.length === 0 && fieldValue.length === 0) {
      return [];
    }

    return [{ key, value: fieldValue } satisfies FieldsBlockItem];
  });
}

function buildFieldsBlockMarkdown(items: FieldsBlockItem[]): string {
  const content = serializeFieldsBlockItems(items);
  return content.length > 0
    ? `:::fields\n${content}\n:::\n\n`
    : ':::fields\n:::\n\n';
}

function FieldsBlockView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const items = normalizeItems(node.attrs.items);
  const editable = editor.isEditable;

  function updateItem(index: number, patch: Partial<FieldsBlockItem>) {
    const nextItems = items.map((item, itemIndex) => {
      if (itemIndex !== index) {
        return item;
      }

      return {
        key: patch.key !== undefined ? patch.key : item.key,
        value: patch.value !== undefined ? patch.value : item.value,
      } satisfies FieldsBlockItem;
    });
    updateAttributes({ items: nextItems });
  }

  function removeItem(index: number) {
    updateAttributes({ items: items.filter((_, itemIndex) => itemIndex !== index) });
  }

  function addItem() {
    updateAttributes({ items: [...items, { key: '', value: '' } satisfies FieldsBlockItem] });
  }

  return (
    <NodeViewWrapper className={selected ? 'ui-rich-fields-block ui-rich-fields-block-selected' : 'ui-rich-fields-block'}>
      <div className="ui-rich-fields-block-header">
        <p className="ui-section-label">Fields</p>
        {editable ? (
          <button type="button" onClick={addItem} className="ui-rich-fields-block-action">
            + Add field
          </button>
        ) : null}
      </div>

      <div className="ui-rich-fields-grid">
        {items.length > 0 ? items.map((item, index) => (
          <div key={`${index}:${item.key}`} className="ui-rich-fields-row">
            {editable ? (
              <input
                value={item.key}
                onChange={(event) => updateItem(index, { key: event.target.value })}
                placeholder="Label"
                className="ui-rich-fields-key-input"
              />
            ) : (
              <span className="ui-rich-fields-key">{item.key}</span>
            )}

            {editable ? (
              <input
                value={item.value}
                onChange={(event) => updateItem(index, { value: event.target.value })}
                placeholder="Value"
                className="ui-rich-fields-value-input"
              />
            ) : (
              <span className="ui-rich-fields-value">{item.value}</span>
            )}

            {editable ? (
              <button type="button" onClick={() => removeItem(index)} className="ui-rich-fields-block-action text-danger">
                Remove
              </button>
            ) : null}
          </div>
        )) : (
          <div className="ui-rich-fields-empty">
            {editable ? 'Add labeled values for durable context.' : 'No fields.'}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const FieldsBlockExtension = Node.create({
  name: 'fieldsBlock',
  group: 'block',
  atom: true,
  draggable: false,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      items: {
        default: [],
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{
      tag: 'div[data-fields-block]',
      getAttrs: (element) => {
        if (!(element instanceof HTMLElement)) {
          return { items: [] };
        }

        const raw = element.dataset.items;
        if (!raw) {
          return { items: [] };
        }

        try {
          const parsed = JSON.parse(raw) as unknown;
          return { items: normalizeItems(parsed) };
        } catch {
          return { items: [] };
        }
      },
    }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      {
        ...HTMLAttributes,
        'data-fields-block': 'true',
        'data-items': JSON.stringify(normalizeItems(node.attrs.items)),
      },
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FieldsBlockView);
  },

  addCommands() {
    return {
      insertFieldsBlock: () => ({ chain }: CommandProps) => chain().insertContent({
        type: this.name,
        attrs: {
          items: [{ key: 'Label', value: 'Value' } satisfies FieldsBlockItem],
        },
      }).run(),
    };
  },

  markdownTokenizer: {
    name: 'fieldsBlock',
    level: 'block',
    start: (src: string) => src.indexOf(':::fields'),
    tokenize: (src: string) => {
      const match = /^:::fields[ \t]*\n([\s\S]*?)\n:::(?:\n|$)/.exec(src);
      if (!match) {
        return undefined;
      }

      return {
        type: 'fieldsBlock',
        raw: match[0],
        items: parseFieldsBlockItems(match[1] ?? ''),
      };
    },
  },

  parseMarkdown: (token, helpers) => helpers.createNode('fieldsBlock', {
    items: normalizeItems((token as { items?: unknown }).items),
  }),

  renderMarkdown: (node) => buildFieldsBlockMarkdown(normalizeItems(node.attrs?.items)),
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fieldsBlock: {
      insertFieldsBlock: () => ReturnType;
    };
  }
}
