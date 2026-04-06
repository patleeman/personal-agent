import React, { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { MentionItem } from './conversationMentions';
import { buildNodeMentionHref, type NodeMentionSurface } from './nodeMentionRoutes';

const MENTION_REGEX = /@[A-Za-z0-9_][A-Za-z0-9_./-]*/g;
const TRAILING_MENTION_PUNCTUATION_REGEX = /[),.;:!?\]}>]+$/;

function isNodeMentionItem(item: MentionItem): boolean {
  return item.kind === 'note' || item.kind === 'skill';
}

function splitMentionFragments(text: string): Array<{ text: string; mention: boolean }> {
  const fragments: Array<{ text: string; mention: boolean }> = [];
  let cursor = 0;
  let match: RegExpExecArray | null = null;

  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const rawMention = match[0];
    const mention = rawMention.replace(TRAILING_MENTION_PUNCTUATION_REGEX, '');
    const start = match.index;
    const end = start + mention.length;
    const previous = start > 0 ? text[start - 1] : '';
    const shouldSkip = start > 0 && /[\w./+-]/.test(previous);

    if (shouldSkip || mention === '@') {
      continue;
    }

    if (start > cursor) {
      fragments.push({ text: text.slice(cursor, start), mention: false });
    }

    fragments.push({ text: mention, mention: true });
    cursor = end;
  }

  if (cursor < text.length) {
    fragments.push({ text: text.slice(cursor), mention: false });
  }

  return fragments;
}

function getMarkdownTagName(node: ReactNode): string | null {
  if (!isValidElement(node)) {
    return null;
  }

  const props = node.props as { node?: { tagName?: string } };
  if (typeof props.node?.tagName === 'string') {
    return props.node.tagName;
  }

  return typeof node.type === 'string' ? node.type : null;
}

export function buildMentionLookup(items: MentionItem[] | null | undefined): Map<string, MentionItem[]> {
  const lookup = new Map<string, MentionItem[]>();
  if (!Array.isArray(items)) {
    return lookup;
  }

  for (const item of items) {
    if (!isNodeMentionItem(item)) {
      continue;
    }

    const key = item.id;
    const existing = lookup.get(key);
    if (existing) {
      existing.push(item);
    } else {
      lookup.set(key, [item]);
    }
  }

  return lookup;
}

function renderMentionFragment(
  mention: string,
  index: number,
  lookup: Map<string, MentionItem[]>,
  surface: NodeMentionSurface,
): ReactNode {
  const matches = lookup.get(mention) ?? [];
  if (matches.length !== 1) {
    return <span key={`${mention}-${index}`} className="ui-markdown-mention">{mention}</span>;
  }

  const href = buildNodeMentionHref(matches[0] as MentionItem, surface);
  if (!href) {
    return <span key={`${mention}-${index}`} className="ui-markdown-mention">{mention}</span>;
  }

  return (
    <Link
      key={`${mention}-${index}`}
      to={href}
      className="ui-markdown-mention no-underline transition-colors hover:bg-accent/15 hover:text-accent"
    >
      {mention}
    </Link>
  );
}

export function renderTextWithMentionLinks(
  text: string,
  options: { lookup: Map<string, MentionItem[]>; surface: NodeMentionSurface },
): ReactNode[] {
  return splitMentionFragments(text).map((fragment, index) => {
    if (fragment.mention) {
      return renderMentionFragment(fragment.text, index, options.lookup, options.surface);
    }

    return <React.Fragment key={`${index}-${fragment.text}`}>{fragment.text}</React.Fragment>;
  });
}

export function renderChildrenWithMentionLinks(
  children: ReactNode,
  options: { lookup: Map<string, MentionItem[]>; surface: NodeMentionSurface },
): ReactNode {
  return Children.map(children, (child, index) => {
    if (typeof child === 'string') {
      return <React.Fragment key={index}>{renderTextWithMentionLinks(child, options)}</React.Fragment>;
    }

    if (typeof child === 'number' || typeof child === 'bigint') {
      return child;
    }

    if (!isValidElement(child)) {
      return child;
    }

    const tagName = getMarkdownTagName(child);
    if (tagName && ['a', 'code', 'pre'].includes(tagName)) {
      return child;
    }

    const props = child.props as { children?: ReactNode };
    if (props.children === undefined) {
      return child;
    }

    return cloneElement(child as ReactElement<{ children?: ReactNode }>, undefined, renderChildrenWithMentionLinks(props.children, options));
  });
}
