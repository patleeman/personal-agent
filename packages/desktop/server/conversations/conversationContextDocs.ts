import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getStateRoot } from '@personal-agent/core';

export type ConversationContextDocKind = 'doc' | 'file';

export interface ConversationContextDocRef {
  path: string;
  title: string;
  kind: ConversationContextDocKind;
  mentionId?: string;
  summary?: string;
}

interface StoredConversationContextDocsDocument {
  version: 1;
  conversationId: string;
  attachedContextDocs: ConversationContextDocRef[];
}

function resolveConversationContextDocsStateRoot(stateRoot: string = getStateRoot()): string {
  return join(stateRoot, 'pi-agent', 'state', 'conversation-context-docs');
}

function resolveConversationContextDocsPath(conversationId: string, stateRoot?: string): string {
  return join(resolveConversationContextDocsStateRoot(stateRoot), `${encodeURIComponent(conversationId)}.json`);
}

function normalizeConversationId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('conversationId required');
  }

  return normalized;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeContextDocRef(value: unknown): ConversationContextDocRef | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const ref = value as Partial<ConversationContextDocRef>;
  const path = normalizeOptionalText(ref.path);
  if (!path) {
    return null;
  }

  const normalizedKind: ConversationContextDocKind = ref.kind === 'doc' || ref.kind === 'file'
    ? ref.kind
    : 'file';
  const title = normalizeOptionalText(ref.title)
    ?? basename(path)
    ?? path;

  return {
    path,
    title,
    kind: normalizedKind,
    ...(normalizeOptionalText(ref.mentionId) ? { mentionId: normalizeOptionalText(ref.mentionId) } : {}),
    ...(normalizeOptionalText(ref.summary) ? { summary: normalizeOptionalText(ref.summary) } : {}),
  };
}

function normalizeContextDocRefs(values: unknown): ConversationContextDocRef[] {
  const refs = Array.isArray(values)
    ? values
      .map((value) => normalizeContextDocRef(value))
      .filter((value): value is ConversationContextDocRef => value !== null)
    : [];

  const deduped: ConversationContextDocRef[] = [];
  const seenPaths = new Set<string>();
  for (const ref of refs) {
    if (seenPaths.has(ref.path)) {
      continue;
    }

    seenPaths.add(ref.path);
    deduped.push(ref);
  }

  return deduped;
}

function readStoredConversationContextDocsDocument(path: string): StoredConversationContextDocsDocument | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<StoredConversationContextDocsDocument>;
    if (parsed.version !== 1 || typeof parsed.conversationId !== 'string') {
      return null;
    }

    return {
      version: 1,
      conversationId: parsed.conversationId,
      attachedContextDocs: normalizeContextDocRefs(parsed.attachedContextDocs),
    };
  } catch {
    return null;
  }
}

export function readConversationContextDocs(conversationIdInput: string, stateRoot?: string): ConversationContextDocRef[] {
  const conversationId = normalizeConversationId(conversationIdInput);
  const path = resolveConversationContextDocsPath(conversationId, stateRoot);
  if (!existsSync(path)) {
    return [];
  }

  const document = readStoredConversationContextDocsDocument(path);
  if (!document) {
    return [];
  }

  return document.attachedContextDocs;
}

export function writeConversationContextDocs(input: {
  conversationId: string;
  attachedContextDocs: unknown;
  stateRoot?: string;
}): ConversationContextDocRef[] {
  const conversationId = normalizeConversationId(input.conversationId);
  const attachedContextDocs = normalizeContextDocRefs(input.attachedContextDocs);
  const path = resolveConversationContextDocsPath(conversationId, input.stateRoot);

  if (attachedContextDocs.length === 0) {
    rmSync(path, { force: true });
    return [];
  }

  mkdirSync(resolveConversationContextDocsStateRoot(input.stateRoot), { recursive: true });
  const document: StoredConversationContextDocsDocument = {
    version: 1,
    conversationId,
    attachedContextDocs,
  };
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  return attachedContextDocs;
}

export function buildAttachedConversationContextDocsContext(attachedContextDocs: ConversationContextDocRef[]): string {
  if (attachedContextDocs.length === 0) {
    return '';
  }

  return [
    'Attached conversation context docs:',
    ...attachedContextDocs.map((doc) => [
      `- ${doc.title}`,
      `  kind: ${doc.kind}`,
      `  path: ${doc.path}`,
      ...(doc.summary ? [`  summary: ${doc.summary}`] : []),
      ...(doc.mentionId ? [`  mention: ${doc.mentionId}`] : []),
    ].join('\n')),
    'These docs are persistently attached to this conversation. Treat them as stable background context even when the current prompt does not mention them. Read the exact file when you need more detail.',
  ].join('\n');
}
