import { mergeAttributes, Node } from '@tiptap/core';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { Suggestion } from '@tiptap/suggestion';

import type { VaultEntry } from '../../shared/types';

export interface WikiLinkAttributes {
  target: string;
  label: string | null;
}

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
      return [
        'span',
        mergeAttributes(HTMLAttributes, {
          'data-wikilink': node.attrs.target,
          class: 'kb-wikilink',
        }),
        node.attrs.label ?? node.attrs.target,
      ];
    },

    // ── Markdown ──────────────────────────────────────────────────────────────

    // @ts-ignore — TipTap v3 markdown extension reads these
    markdownTokenName: 'wikiLink',

    // @ts-ignore
    markdownTokenizer: {
      name: 'wikiLink',
      level: 'inline' as const,
      start: '[[',
      tokenize(src: string) {
        const match = src.match(new RegExp(String.raw`^\[\[([^\[\]\|]+)(?:\|([^\[\]]+))?\]\]`));
        if (!match) return undefined;
        return { type: 'wikiLink', raw: match[0], target: match[1]!.trim(), label: match[2]?.trim() ?? null, tokens: [] };
      },
    },

    // @ts-ignore
    parseMarkdown(token: { target: string; label: string | null }) {
      return { type: 'wikiLink', attrs: { target: token.target, label: token.label } };
    },

    // @ts-ignore
    renderMarkdown(node: { attrs: WikiLinkAttributes }) {
      const { target, label } = node.attrs;
      return label ? `[[${target}|${label}]]` : `[[${target}]]`;
    },

    // ── Node view — handles broken link styling and click navigation ──────────

    addNodeView() {
      return ({ node }) => {
        const span = document.createElement('span');
        const target = node.attrs.target as string;

        const updateState = () => {
          const entries = getEntries();
          const exists = entries.some(
            (e) => e.kind === 'file' && (e.name === target || e.name === `${target}.md` || e.id === target || e.id === `${target}.md`),
          );
          span.className = exists ? 'kb-wikilink' : 'kb-wikilink kb-wikilink-broken';
          span.setAttribute('data-wikilink', target);
          span.setAttribute('title', exists ? `Open ${target}` : `"${target}" not found`);
          span.textContent = node.attrs.label ?? target;
        };

        updateState();

        span.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const entries = getEntries();
          const found = entries.find((e) => e.name === target || e.name === `${target}.md` || e.id === target || e.id === `${target}.md`);
          if (found) onFileNavigate(found.id);
        });

        return {
          dom: span,
          update: () => {
            updateState();
            return true;
          },
        };
      };
    },

    // ── Suggestion ────────────────────────────────────────────────────────────

    addProseMirrorPlugins() {
      const rendered = renderSuggestion();

      return [
        Suggestion<VaultEntry>({
          editor: this.editor,
          char: '[[',
          allowSpaces: true,
          items: ({ query }) => {
            // Always use latest entries (ref is updated on kb events)
            const q = query.toLowerCase();
            const entries = getEntries().filter((e) => e.kind === 'file');
            if (!q) return entries.slice(0, 12);
            return entries.filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)).slice(0, 12);
          },
          command: ({ editor, range, props }) => {
            const target = props.name.replace(/\.md$/, '');
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({ type: 'wikiLink', attrs: { target, label: null } })
              .run();
            editor.commands.insertContent(' ');
          },
          render: () => rendered,
        }),
      ];
    },
  });
}
