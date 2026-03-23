import { normalizeDetectedFilePath } from './filePathLinks';

export const CONVERSATION_FILE_QUERY_PARAM = 'peekFile';
export const CONVERSATION_FILE_CWD_QUERY_PARAM = 'peekCwd';

export interface ConversationFileTarget {
  cwd: string;
  file: string;
}

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

function isAbsoluteFilePath(path: string): boolean {
  const normalized = normalizePathSeparators(path);
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
}

function dirnameLike(path: string): string {
  const normalized = normalizePathSeparators(path).replace(/\/+$/, '');
  const lastSlashIndex = normalized.lastIndexOf('/');

  if (lastSlashIndex < 0) {
    return '.';
  }

  if (lastSlashIndex === 0) {
    return '/';
  }

  return normalized.slice(0, lastSlashIndex);
}

function resolveRelativeFilePath(base: string, relativePath: string): string | null {
  const normalizedBase = normalizePathSeparators(base).trim();
  if (!normalizedBase || !normalizedBase.startsWith('/')) {
    return null;
  }

  try {
    const baseUrl = `file://${normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`}`;
    return decodeURIComponent(new URL(relativePath, baseUrl).pathname);
  } catch {
    return null;
  }
}

export function getConversationFileTargetFromSearch(search: string): ConversationFileTarget | null {
  const params = new URLSearchParams(search);
  const cwd = params.get(CONVERSATION_FILE_CWD_QUERY_PARAM)?.trim() ?? '';
  const file = params.get(CONVERSATION_FILE_QUERY_PARAM)?.trim() ?? '';

  if (!cwd || !file) {
    return null;
  }

  return { cwd, file };
}

export function setConversationFileTargetInSearch(search: string, target: ConversationFileTarget | null): string {
  const params = new URLSearchParams(search);

  if (target?.cwd.trim() && target.file.trim()) {
    params.set(CONVERSATION_FILE_CWD_QUERY_PARAM, target.cwd.trim());
    params.set(CONVERSATION_FILE_QUERY_PARAM, target.file.trim());
  } else {
    params.delete(CONVERSATION_FILE_CWD_QUERY_PARAM);
    params.delete(CONVERSATION_FILE_QUERY_PARAM);
  }

  const next = params.toString();
  return next.length > 0 ? `?${next}` : '';
}

export function buildConversationFileHref(pathname: string, search: string, target: ConversationFileTarget): string {
  return `${pathname}${setConversationFileTargetInSearch(search, target)}`;
}

export function resolveConversationFileTarget(pathCandidate: string, currentCwd: string | null | undefined): ConversationFileTarget | null {
  const normalizedPath = normalizeDetectedFilePath(pathCandidate);
  if (!normalizedPath) {
    return null;
  }

  if (normalizedPath.startsWith('~/') || isAbsoluteFilePath(normalizedPath)) {
    return {
      cwd: dirnameLike(normalizedPath),
      file: normalizedPath,
    };
  }

  const trimmedCwd = currentCwd?.trim() ?? '';
  if (!trimmedCwd) {
    return null;
  }

  if (normalizedPath.startsWith('./') || normalizedPath.startsWith('../')) {
    const resolvedPath = resolveRelativeFilePath(trimmedCwd, normalizedPath);
    if (resolvedPath) {
      return {
        cwd: trimmedCwd,
        file: resolvedPath,
      };
    }
  }

  return {
    cwd: trimmedCwd,
    file: normalizedPath,
  };
}
