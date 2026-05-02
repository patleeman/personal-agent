import { parseDocument, stringify } from 'yaml';

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export type MarkdownFrontmatter = Record<string, unknown>;

export interface MarkdownDocumentParts {
  rawFrontmatter: string | null;
  frontmatter: MarkdownFrontmatter | null;
  frontmatterError: string | null;
  body: string;
}

function splitMarkdownFrontmatter(content: string): { rawFrontmatter: string | null; body: string } {
  const normalized = normalizeNewlines(content);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    return {
      rawFrontmatter: null,
      body: normalized.replace(/^\n+/, ''),
    };
  }

  return {
    rawFrontmatter: match[1] ?? '',
    body: (match[2] ?? '').replace(/^\n+/, ''),
  };
}

function normalizeFrontmatterValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeFrontmatterValue(entry));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, normalizeFrontmatterValue(entry)]),
    );
  }

  return value;
}

export function isMarkdownFrontmatterValueEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (value instanceof Date) {
    return false;
  }

  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length === 0;
  }

  return false;
}

export function countMarkdownFrontmatterFields(frontmatter: MarkdownFrontmatter | null): number {
  if (!frontmatter) {
    return 0;
  }

  return Object.values(frontmatter).filter((value) => !isMarkdownFrontmatterValueEmpty(value)).length;
}

function compactMarkdownFrontmatter(frontmatter: MarkdownFrontmatter): MarkdownFrontmatter {
  return Object.fromEntries(Object.entries(frontmatter).filter(([, value]) => !isMarkdownFrontmatterValueEmpty(value)));
}

export function parseMarkdownDocument(content: string): MarkdownDocumentParts {
  const split = splitMarkdownFrontmatter(content);
  const { rawFrontmatter, body } = split;

  if (rawFrontmatter === null) {
    return {
      rawFrontmatter: null,
      frontmatter: null,
      frontmatterError: null,
      body,
    };
  }

  const document = parseDocument(rawFrontmatter, {
    merge: true,
    prettyErrors: true,
  });

  if (document.errors.length > 0) {
    return {
      rawFrontmatter,
      frontmatter: null,
      frontmatterError: document.errors[0]?.message ?? 'Invalid YAML frontmatter.',
      body,
    };
  }

  const parsed = document.toJS();
  if (parsed === null || parsed === undefined) {
    return {
      rawFrontmatter,
      frontmatter: {},
      frontmatterError: null,
      body,
    };
  }

  if (Array.isArray(parsed) || typeof parsed !== 'object') {
    return {
      rawFrontmatter,
      frontmatter: null,
      frontmatterError: 'YAML frontmatter must evaluate to an object.',
      body,
    };
  }

  return {
    rawFrontmatter,
    frontmatter: normalizeFrontmatterValue(parsed) as MarkdownFrontmatter,
    frontmatterError: null,
    body,
  };
}

export function stripMarkdownFrontmatter(content: string): string {
  return parseMarkdownDocument(content).body;
}

export function stringifyMarkdownFrontmatter(frontmatter: MarkdownFrontmatter, body: string): string {
  const normalizedBody = normalizeNewlines(body).replace(/^\n+/, '');
  const compacted = compactMarkdownFrontmatter(frontmatter);

  if (Object.keys(compacted).length === 0) {
    return normalizedBody;
  }

  const rendered = stringify(compacted, {
    lineWidth: 0,
    indent: 2,
    minContentWidth: 0,
  }).trimEnd();

  return `---\n${rendered}\n---\n\n${normalizedBody}`;
}
