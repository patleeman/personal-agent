import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getPiAgentRuntimeDir } from '@personal-agent/core';

const CACHE_VERSION = 1;
const SUMMARY_PROMPT_VERSION = 'related-conversation-summary-v1';
const MAX_CACHE_ENTRIES = 200;
const CACHE_FILE_NAME = 'related-conversation-summary-cache.json';

export interface RelatedConversationSummaryCacheEntry {
  key: string;
  sessionId: string;
  sessionFile: string;
  sessionSignature: string;
  promptHash: string;
  promptPreview: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

interface RelatedConversationSummaryCacheDocument {
  version: 1;
  entries: RelatedConversationSummaryCacheEntry[];
}

export interface RelatedConversationSummaryCacheInput {
  sessionId: string;
  sessionFile: string;
  prompt: string;
  summary?: string;
  cacheFile?: string;
}

function getDefaultCacheFile(): string {
  return join(getPiAgentRuntimeDir(), CACHE_FILE_NAME);
}

export function readSessionFileSignature(filePath: string): string | null {
  try {
    const stats = statSync(filePath);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return null;
  }
}

function normalizePromptForCache(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildPromptHash(prompt: string): string {
  return sha256(normalizePromptForCache(prompt));
}

function buildCacheKey(input: { sessionFile: string; sessionSignature: string; promptHash: string }): string {
  return sha256([SUMMARY_PROMPT_VERSION, input.sessionFile, input.sessionSignature, input.promptHash].join('\0'));
}

function parseCacheDocument(value: string): RelatedConversationSummaryCacheDocument {
  const parsed = JSON.parse(value) as Partial<RelatedConversationSummaryCacheDocument>;
  if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) {
    return { version: CACHE_VERSION, entries: [] };
  }

  return {
    version: CACHE_VERSION,
    entries: parsed.entries.filter(isCacheEntry),
  };
}

function isCacheEntry(value: unknown): value is RelatedConversationSummaryCacheEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Partial<RelatedConversationSummaryCacheEntry>;
  return typeof entry.key === 'string'
    && typeof entry.sessionId === 'string'
    && typeof entry.sessionFile === 'string'
    && typeof entry.sessionSignature === 'string'
    && typeof entry.promptHash === 'string'
    && typeof entry.promptPreview === 'string'
    && typeof entry.summary === 'string'
    && typeof entry.createdAt === 'string'
    && typeof entry.updatedAt === 'string';
}

function readCacheDocument(cacheFile: string): RelatedConversationSummaryCacheDocument {
  if (!existsSync(cacheFile)) {
    return { version: CACHE_VERSION, entries: [] };
  }

  try {
    return parseCacheDocument(readFileSync(cacheFile, 'utf-8'));
  } catch {
    return { version: CACHE_VERSION, entries: [] };
  }
}

function writeCacheDocument(cacheFile: string, document: RelatedConversationSummaryCacheDocument): void {
  mkdirSync(dirname(cacheFile), { recursive: true });
  const temporaryFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify(document)}\n`, 'utf-8');
  renameSync(temporaryFile, cacheFile);
}

function resolveCacheLookup(input: RelatedConversationSummaryCacheInput): {
  cacheFile: string;
  sessionSignature: string;
  promptHash: string;
  key: string;
} | null {
  const sessionSignature = readSessionFileSignature(input.sessionFile);
  if (!sessionSignature) {
    return null;
  }

  const promptHash = buildPromptHash(input.prompt);
  const key = buildCacheKey({
    sessionFile: input.sessionFile,
    sessionSignature,
    promptHash,
  });

  return {
    cacheFile: input.cacheFile ?? getDefaultCacheFile(),
    sessionSignature,
    promptHash,
    key,
  };
}

export function readCachedRelatedConversationSummary(input: RelatedConversationSummaryCacheInput): string | null {
  const lookup = resolveCacheLookup(input);
  if (!lookup) {
    return null;
  }

  const document = readCacheDocument(lookup.cacheFile);
  const entry = document.entries.find((candidate) => candidate.key === lookup.key);
  const summary = entry?.summary.trim();
  return summary && summary.length > 0 ? summary : null;
}

export function writeCachedRelatedConversationSummary(input: RelatedConversationSummaryCacheInput): void {
  const summary = input.summary?.trim();
  if (!summary) {
    return;
  }

  const lookup = resolveCacheLookup(input);
  if (!lookup) {
    return;
  }

  const document = readCacheDocument(lookup.cacheFile);
  const now = new Date().toISOString();
  const existing = document.entries.find((entry) => entry.key === lookup.key);
  const nextEntry: RelatedConversationSummaryCacheEntry = {
    key: lookup.key,
    sessionId: input.sessionId,
    sessionFile: input.sessionFile,
    sessionSignature: lookup.sessionSignature,
    promptHash: lookup.promptHash,
    promptPreview: normalizePromptForCache(input.prompt).slice(0, 160),
    summary,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const entries = [
    nextEntry,
    ...document.entries.filter((entry) => entry.key !== lookup.key),
  ].slice(0, MAX_CACHE_ENTRIES);

  try {
    writeCacheDocument(lookup.cacheFile, { version: CACHE_VERSION, entries });
  } catch {
    // Cache writes are best-effort; summarization should still succeed if the cache is unavailable.
  }
}
