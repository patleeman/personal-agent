import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { tags } from '@lezer/highlight';

export function languageExtensionForPath(path: string): Extension | null {
  const normalized = path.toLowerCase();

  if (normalized.endsWith('.ts')) {
    return javascript({ typescript: true });
  }
  if (normalized.endsWith('.tsx')) {
    return javascript({ typescript: true, jsx: true });
  }
  if (normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) {
    return javascript();
  }
  if (normalized.endsWith('.jsx')) {
    return javascript({ jsx: true });
  }
  if (normalized.endsWith('.json') || normalized.endsWith('.jsonc')) {
    return json();
  }
  if (normalized.endsWith('.md') || normalized.endsWith('.mdx')) {
    return markdown();
  }
  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) {
    return html();
  }
  if (normalized.endsWith('.css') || normalized.endsWith('.scss')) {
    return css();
  }
  if (normalized.endsWith('.yml') || normalized.endsWith('.yaml')) {
    return yaml();
  }
  if (normalized.endsWith('.py')) {
    return python();
  }

  return null;
}

export function editorChromeTheme(isDark: boolean): Extension {
  const highlightTheme = HighlightStyle.define([
    { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.modifier], color: isDark ? 'rgb(224 152 48)' : 'rgb(149 90 16)' },
    { tag: [tags.atom, tags.bool, tags.number, tags.integer, tags.float], color: isDark ? 'rgb(91 144 204)' : 'rgb(30 90 150)' },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: isDark ? 'rgb(61 168 168)' : 'rgb(26 120 120)' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'rgb(var(--color-dim))', fontStyle: 'italic' },
    { tag: [tags.typeName, tags.className, tags.namespace, tags.definition(tags.typeName)], color: isDark ? 'rgb(242 239 232)' : 'rgb(28 26 20)' },
    { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: 'rgb(var(--color-primary))' },
    { tag: [tags.definition(tags.variableName), tags.function(tags.variableName), tags.labelName], color: isDark ? 'rgb(242 239 232)' : 'rgb(28 26 20)' },
    { tag: [tags.punctuation, tags.separator, tags.bracket], color: 'rgb(var(--color-secondary))' },
    { tag: [tags.meta, tags.docString], color: 'rgb(var(--color-dim))' },
    { tag: tags.invalid, color: 'rgb(var(--color-danger))' },
  ]);

  return [
    EditorView.theme({
      '&': {
        height: '100%',
        color: 'rgb(var(--color-primary))',
        backgroundColor: 'rgb(var(--color-panel))',
        fontSize: '12px',
        fontWeight: '400',
      },
      '.cm-scroller': {
        fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", monospace',
        lineHeight: '1.65',
        fontWeight: '400',
        backgroundColor: 'rgb(var(--color-panel))',
      },
      '.cm-content': {
        minHeight: '100%',
        padding: '14px 16px',
        caretColor: 'rgb(var(--color-accent))',
      },
      '.cm-gutters': {
        minHeight: '100%',
        border: 'none',
        borderRight: '1px solid rgb(var(--color-border-subtle))',
        backgroundColor: isDark ? 'rgb(60 57 51)' : 'rgb(237 233 226)',
        color: 'rgb(var(--color-dim))',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 10px 0 6px',
      },
      '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: isDark ? 'rgb(224 152 48 / 0.09)' : 'rgb(149 90 16 / 0.055)',
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: isDark ? 'rgb(224 152 48 / 0.18)' : 'rgb(149 90 16 / 0.13)',
      },
      '.cm-focused': {
        outline: 'none',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'rgb(var(--color-accent))',
        borderLeftWidth: '2px',
      },
      '.cm-tooltip, .cm-panels, .cm-completionInfo': {
        backgroundColor: 'rgb(var(--color-surface))',
        borderColor: 'rgb(var(--color-border-default))',
        color: 'rgb(var(--color-primary))',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: isDark ? 'rgb(224 152 48 / 0.12)' : 'rgb(149 90 16 / 0.08)',
        color: 'rgb(var(--color-primary))',
      },
      '.cm-searchMatch': {
        backgroundColor: isDark ? 'rgb(224 152 48 / 0.14)' : 'rgb(149 90 16 / 0.10)',
        outline: '1px solid rgb(var(--color-border-default))',
      },
      '.cm-matchingBracket, .cm-nonmatchingBracket': {
        backgroundColor: isDark ? 'rgb(91 144 204 / 0.12)' : 'rgb(30 90 150 / 0.10)',
        outline: '1px solid rgb(var(--color-border-subtle))',
      },
      '&.cm-mergeView .cm-changedText, &.cm-mergeView .cm-deletedText, &.cm-mergeView .cm-insertedLine, &.cm-mergeView .cm-deletedLine, &.cm-mergeView .cm-deletedLine del': {
        textDecoration: 'none',
      },
      '&.cm-merge-b .cm-changedText': {
        background: isDark ? 'rgb(61 168 168 / 0.18)' : 'rgb(26 120 120 / 0.14)',
        borderRadius: '2px',
      },
      '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
        background: isDark ? 'rgb(210 96 96 / 0.18)' : 'rgb(186 66 66 / 0.14)',
        borderRadius: '2px',
      },
    }, { dark: isDark }),
    syntaxHighlighting(highlightTheme),
  ];
}
