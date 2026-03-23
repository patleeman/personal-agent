import type { ReactNode } from 'react';
import { looksLikeLocalFilesystemPath } from './localPaths';

export type FilePathButtonVariant = 'text' | 'code' | 'pre';

const FILE_PATH_TOKEN_REGEX = /[~A-Za-z0-9_./\\:-]+/g;
const LEADING_TOKEN_PUNCTUATION_REGEX = /^[`"'([{<]+/;
const TRAILING_TOKEN_PUNCTUATION_REGEX = /[`"'),.;:!?\]}>]+$/;
const KNOWN_FILE_EXTENSIONS = new Set([
  'c',
  'cc',
  'cfg',
  'conf',
  'cpp',
  'css',
  'csv',
  'gif',
  'go',
  'graphql',
  'h',
  'hpp',
  'html',
  'ini',
  'java',
  'jpeg',
  'jpg',
  'js',
  'json',
  'jsonc',
  'jsx',
  'lock',
  'log',
  'lua',
  'm4a',
  'md',
  'mdx',
  'mjs',
  'mov',
  'mp3',
  'mp4',
  'ogg',
  'pdf',
  'php',
  'png',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'svg',
  'test',
  'toml',
  'ts',
  'tsx',
  'txt',
  'wav',
  'webm',
  'webp',
  'xml',
  'yaml',
  'yml',
  'zsh',
]);
const KNOWN_FILE_BASENAMES = new Set([
  '.env',
  '.gitignore',
  '.npmrc',
  '.prettierrc',
  'AGENTS.md',
  'Dockerfile',
  'LICENSE',
  'LICENSE.md',
  'Makefile',
  'MEMORY.md',
  'README',
  'README.md',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'yarn.lock',
]);

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

function splitTokenPunctuation(rawToken: string): { leading: string; candidate: string; trailing: string } {
  const leading = rawToken.match(LEADING_TOKEN_PUNCTUATION_REGEX)?.[0] ?? '';
  const trailing = rawToken.match(TRAILING_TOKEN_PUNCTUATION_REGEX)?.[0] ?? '';
  const candidate = rawToken.slice(leading.length, rawToken.length - trailing.length);
  return { leading, candidate, trailing };
}

function looksLikeFileName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || !/[A-Za-z]/.test(trimmed)) {
    return false;
  }

  if (KNOWN_FILE_BASENAMES.has(trimmed)) {
    return true;
  }

  const extensionMatch = trimmed.match(/\.([A-Za-z0-9_-]+)$/);
  if (!extensionMatch) {
    return false;
  }

  return KNOWN_FILE_EXTENSIONS.has(extensionMatch[1].toLowerCase());
}

function looksLikeWorkspaceRelativeFilePath(value: string): boolean {
  const normalized = normalizePathSeparators(value.trim());
  if (!normalized || normalized.includes('://') || normalized.startsWith('#') || normalized.startsWith('mailto:')) {
    return false;
  }

  if (normalized.startsWith('/')) {
    return false;
  }

  const withoutRelativePrefix = normalized.replace(/^(?:\.\/?|\.\.\/)+/, '');
  if (!withoutRelativePrefix || withoutRelativePrefix.endsWith('/')) {
    return false;
  }

  const baseName = withoutRelativePrefix.split('/').at(-1) ?? withoutRelativePrefix;
  return looksLikeFileName(baseName);
}

export function normalizeDetectedFilePath(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed.includes('\n') || trimmed.includes('\r')) {
    return null;
  }

  let normalized = trimmed;
  if (normalized.startsWith('file://')) {
    try {
      normalized = decodeURIComponent(normalized.replace(/^file:\/\//, ''));
    } catch {
      normalized = normalized.replace(/^file:\/\//, '');
    }
  }

  normalized = normalizePathSeparators(normalized);

  if (looksLikeLocalFilesystemPath(normalized)) {
    return normalized;
  }

  if (!looksLikeWorkspaceRelativeFilePath(normalized)) {
    return null;
  }

  if ((normalized.startsWith('a/') || normalized.startsWith('b/'))
    && normalized.split('/').length > 2
    && looksLikeWorkspaceRelativeFilePath(normalized.slice(2))) {
    return normalized.slice(2);
  }

  return normalized;
}

function filePathButtonClassName(variant: FilePathButtonVariant): string {
  const baseClassName = 'inline-block align-baseline appearance-none border-0 bg-transparent p-0 m-0 cursor-pointer text-left transition-colors focus:outline-none';

  switch (variant) {
    case 'code':
      return `${baseClassName} rounded bg-elevated px-1 py-0.5 font-mono text-[0.82em] text-accent hover:bg-elevated/80 hover:text-primary`;
    case 'pre':
      return `${baseClassName} text-accent hover:text-primary`;
    case 'text':
    default:
      return `${baseClassName} font-mono text-accent hover:text-primary`;
  }
}

export function FilePathButton({
  path,
  displayText,
  variant = 'text',
  onOpenFilePath,
}: {
  path: string;
  displayText: string;
  variant?: FilePathButtonVariant;
  onOpenFilePath?: (path: string) => void;
}) {
  if (!onOpenFilePath) {
    return displayText;
  }

  return (
    <button
      type="button"
      data-file-path-link={path}
      title={`Open ${path}`}
      className={filePathButtonClassName(variant)}
      onClick={() => onOpenFilePath(path)}
      style={{
        textDecoration: 'underline',
        textUnderlineOffset: '0.18em',
        textDecorationColor: 'rgb(var(--color-accent) / 0.32)',
      }}
    >
      {displayText}
    </button>
  );
}

export function renderFilePathTextFragments(
  text: string,
  options: {
    onOpenFilePath?: (path: string) => void;
    variant?: FilePathButtonVariant;
    keyPrefix?: string;
  } = {},
): ReactNode[] {
  const { onOpenFilePath, variant = 'text', keyPrefix = 'path' } = options;
  if (!text || !onOpenFilePath) {
    return [text];
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  FILE_PATH_TOKEN_REGEX.lastIndex = 0;

  while ((match = FILE_PATH_TOKEN_REGEX.exec(text)) !== null) {
    const rawToken = match[0];
    const tokenIndex = match.index;
    const { leading, candidate, trailing } = splitTokenPunctuation(rawToken);
    const normalizedPath = normalizeDetectedFilePath(candidate);
    if (!normalizedPath) {
      continue;
    }

    if (tokenIndex > cursor) {
      parts.push(text.slice(cursor, tokenIndex));
    }
    if (leading) {
      parts.push(leading);
    }

    parts.push(
      <FilePathButton
        key={`${keyPrefix}-${tokenIndex}-${normalizedPath}`}
        path={normalizedPath}
        displayText={candidate}
        variant={variant}
        onOpenFilePath={onOpenFilePath}
      />, 
    );

    if (trailing) {
      parts.push(trailing);
    }

    cursor = tokenIndex + rawToken.length;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.length > 0 ? parts : [text];
}

function renderDiffHeaderLine(line: string, onOpenFilePath?: (path: string) => void, keyPrefix = 'diff'): ReactNode[] | null {
  if (!onOpenFilePath) {
    return null;
  }

  const diffHeaderMatch = line.match(/^(diff --git )a\/(.+?) (b\/.+)$/);
  if (diffHeaderMatch) {
    const leftPath = normalizeDetectedFilePath(diffHeaderMatch[2]);
    const rightPath = normalizeDetectedFilePath(diffHeaderMatch[3]);
    if (leftPath && rightPath) {
      return [
        diffHeaderMatch[1],
        <FilePathButton key={`${keyPrefix}-left-${leftPath}`} path={leftPath} displayText={`a/${diffHeaderMatch[2]}`} variant="pre" onOpenFilePath={onOpenFilePath} />,
        ' ',
        <FilePathButton key={`${keyPrefix}-right-${rightPath}`} path={rightPath} displayText={diffHeaderMatch[3]} variant="pre" onOpenFilePath={onOpenFilePath} />,
      ];
    }
  }

  const patchHeaderMatch = line.match(/^((?:\+\+\+|---)\s+)([ab]\/.*)$/);
  if (patchHeaderMatch) {
    const normalizedPath = normalizeDetectedFilePath(patchHeaderMatch[2]);
    if (normalizedPath) {
      return [
        patchHeaderMatch[1],
        <FilePathButton key={`${keyPrefix}-${normalizedPath}`} path={normalizedPath} displayText={patchHeaderMatch[2]} variant="pre" onOpenFilePath={onOpenFilePath} />,
      ];
    }
  }

  return null;
}

export function FilePathPreformattedText({
  text,
  className,
  onOpenFilePath,
}: {
  text: string;
  className?: string;
  onOpenFilePath?: (path: string) => void;
}) {
  const lines = text.split('\n');

  return (
    <pre className={className}>
      {lines.map((line, index) => {
        const renderedLine = renderDiffHeaderLine(line, onOpenFilePath, `line-${index}`)
          ?? renderFilePathTextFragments(line, { onOpenFilePath, variant: 'pre', keyPrefix: `line-${index}` });

        return (
          <span key={`pre-line-${index}`}>
            {renderedLine}
            {index < (lines.length - 1) ? '\n' : null}
          </span>
        );
      })}
    </pre>
  );
}
