import { Node, mergeAttributes } from '@tiptap/core';
import { Suggestion } from '@tiptap/suggestion';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import type { VaultEntry } from '../../shared/types';

// ── WikiLink node ─────────────────────────────────────────────────────────────
//
// Represents [[Note Name]] or [[Note Name|Display Text]] wikilinks.
// Serializes back to [[target]] in markdown.

export interface WikiLinkAttributes {
  target: string;   // the linked file name (no .md)
  label: string | null; // display text override
}

// Vault entries are passed in at creation time so the suggestion can search them.
export type WikiLinkSuggestionRenderer = () => {
  onStart: (props: SuggestionProps<VaultEntry>) => void;
  onUpdate: (props: SuggestionProps<VaultEntry>) => void;
  onExit: () => void;
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

export function buildWikiLinkExtension(
  getEntries: () => VaultEntry[],
  onFileNavigate: (id: string) => void,
  renderSuggestion: WikiLinkSuggestionRenderer,
) {
  return Node.create({
    name: 'wikiLink',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,

    addAttributes() {
      return {
        target: { default: '' },
        label: { default: null },
      };
    },

    parseHTML() {
      return [{ tag: 'span[data-wikilink]' }];
    },

    renderHTML({ node, HTMLAttributes }) {
      return ['span', mergeAttributes(HTMLAttributes, {
        'data-wikilink': node.attrs.target,
        class: 'kb-wikilink',
      }), node.attrs.label ?? node.attrs.target];
    },

    // ── Markdown integration ────────────────────────────────────────────────

    // @ts-ignore - TipTap v3 markdown extension reads these config fields
    markdownTokenName: 'wikiLink',

    // @ts-ignore
    markdownTokenizer: {
      name: 'wikiLink',
      level: 'inline' as const,
      start: '[[',
      tokenize(src: string) {
        const match = src.match(/^\[\[([^\[\]\|]+)(?:\|([^\[\]]+))?\]\]/);
        if (!match) return undefined;
        return {
          type: 'wikiLink',
          raw: match[0],
          target: match[1]!.trim(),
          label: match[2]?.trim() ?? null,
          tokens: [],
        };
      },
    },

    // @ts-ignore
    parseMarkdown(token: { target: string; label: string | null }) {
      return {
        type: 'wikiLink',
        attrs: { target: token.target, label: token.label },
      };
    },

    // @ts-ignore
    renderMarkdown(node: { attrs: WikiLinkAttributes }) {
      const { target, label } = node.attrs;
      return label ? `[[${target}|${label}]]` : `[[${target}]]`;
    },

    // ── Click to navigate ───────────────────────────────────────────────────

    addNodeView() {
      return ({ node, HTMLAttributes }) => {
        const span = document.createElement('span');
        span.className = 'kb-wikilink';
        span.setAttribute('data-wikilink', node.attrs.target);
        span.textContent = node.attrs.label ?? node.attrs.target;

        span.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Find file by name (without .md) or id
          const target = node.attrs.target as string;
          const entries = getEntries();
          const found = entries.find((e) =>
            e.name === target ||
            e.name === `${target}.md` ||
            e.id === target ||
            e.id === `${target}.md`,
          );
          if (found) {
            onFileNavigate(found.id);
          }
        });

        return { dom: span };
      };
    },

    // ── Suggestion (typing [[ triggers autocomplete) ─────────────────────────

    addProseMirrorPlugins() {
      const rendered = renderSuggestion();

      return [
        Suggestion<VaultEntry>({
          editor: this.editor,
          char: '[[',
          allowSpaces: true,
          items: ({ query }) => {
            const q = query.toLowerCase();
            const entries = getEntries().filter((e) => e.kind === 'file');
            if (!q) return entries.slice(0, 12);
            return entries
              .filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))
              .slice(0, 12);
          },
          command: ({ editor, range, props }) => {
            const target = props.name.replace(/\.md$/, '');
            editor.chain().focus()
              .deleteRange(range)
              .insertContent({
                type: 'wikiLink',
                attrs: { target, label: null },
              })
              .run();
            // Insert a space after the node so the cursor exits it
            editor.commands.insertContent(' ');
          },
          render: () => rendered,
        }),
      ];
    },
  });
}
