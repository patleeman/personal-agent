/**
 * Conversation lifecycle management.
 *
 * A Conversation is the durable anchor for runs:
 * - Has a syncing ID (portable across machines)
 * - Has state: 'open' | 'dormant' | 'closed'
 * - Can be reopened — brings back any pending runs
 * - Subagent runs always roll up under a parent conversation
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type ConversationState = 'open' | 'dormant' | 'closed';

export interface ConversationRecord {
  id: string;
  state: ConversationState;
  createdAt: string;
  updatedAt: string;
  title?: string;
  summary?: string;
  relatedProjectIds: string[];
  // Relationships (derived from child runs)
  childRunIds: string[];
  parentId?: string;
}

const CONVERSATION_FILE_VERSION = 1 as const;

/**
 * Resolve the path to a conversation record.
 */
export function resolveConversationRecordPath(
  stateRoot: string,
  profile: string,
  conversationId: string,
): string {
  return join(
    stateRoot,
    'pi-agent',
    'state',
    'conversation-memory',
    profile,
    `${conversationId}.json`,
  );
}

/**
 * Read a conversation record.
 */
export function readConversationRecord(
  stateRoot: string,
  profile: string,
  conversationId: string,
): ConversationRecord | null {
  const path = resolveConversationRecordPath(stateRoot, profile, conversationId);

  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    return {
      id: String(parsed.conversationId ?? parsed.id ?? conversationId),
      state: (parsed.state as ConversationState) ?? 'open',
      createdAt: String(parsed.createdAt ?? parsed.updatedAt ?? new Date().toISOString()),
      updatedAt: String(parsed.updatedAt ?? parsed.createdAt ?? new Date().toISOString()),
      title: parsed.latestConversationTitle as string | undefined,
      summary: parsed.latestAnchorPreview as string | undefined,
      relatedProjectIds: Array.isArray(parsed.relatedProjectIds)
        ? parsed.relatedProjectIds.map(String)
        : [],
      childRunIds: Array.isArray(parsed.childRunIds)
        ? parsed.childRunIds.map(String)
        : [],
      parentId: parsed.parentId as string | undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Write a conversation record.
 */
export function writeConversationRecord(
  stateRoot: string,
  profile: string,
  record: ConversationRecord,
): void {
  const path = resolveConversationRecordPath(stateRoot, profile, record.id);

  const dir = join(path, '..');
  const { mkdirSync } = require('fs');
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  writeFileSync(path, JSON.stringify({
    version: CONVERSATION_FILE_VERSION,
    conversationId: record.id,
    state: record.state,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.title ? { latestConversationTitle: record.title } : {}),
    ...(record.summary ? { latestAnchorPreview: record.summary } : {}),
    relatedProjectIds: record.relatedProjectIds,
    childRunIds: record.childRunIds,
    ...(record.parentId ? { parentId: record.parentId } : {}),
  }, null, 2), 'utf-8');
}

/**
 * Check if a conversation should be soft-closed (dormant) or hard-closed.
 *
 * Soft close (archive) keeps dormant if pending runs exist.
 * Hard close (cancel) cancels all descendants.
 */
export function getConversationCloseAction(hasPendingRuns: boolean): 'soft' | 'hard' {
  return hasPendingRuns ? 'soft' : 'hard';
}

/**
 * Determine conversation state based on child runs.
 *
 * - 'open' if any child is running
 * - 'dormant' if any child is waiting/queued
 * - 'closed' if all children are terminal
 */
export function deriveConversationState(
  childRunStatuses: string[],
): ConversationState {
  if (childRunStatuses.length === 0) {
    return 'closed';
  }

  const hasRunning = childRunStatuses.some(
    (s) => s === 'running' || s === 'recovering',
  );
  if (hasRunning) {
    return 'open';
  }

  const hasPending = childRunStatuses.some(
    (s) => s === 'queued' || s === 'waiting',
  );
  if (hasPending) {
    return 'dormant';
  }

  return 'closed';
}

/**
 * List all conversations for a profile.
 */
export function listConversationRecords(
  stateRoot: string,
  profile: string,
): ConversationRecord[] {
  const dir = join(
    stateRoot,
    'pi-agent',
    'state',
    'conversation-memory',
    profile,
  );

  if (!existsSync(dir)) {
    return [];
  }

  const { readdirSync } = require('fs');
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry: { isFile(): boolean; name: string }) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry: { name: string }) => {
      const conversationId = entry.name.slice(0, -'.json'.length);
      return readConversationRecord(stateRoot, profile, conversationId);
    })
    .filter((record: ConversationRecord | null): record is ConversationRecord => record !== null);
}

/**
 * Check if a conversation can be reopened.
 */
export function canReopenConversation(record: ConversationRecord): boolean {
  return record.state === 'dormant' || record.state === 'closed';
}

/**
 * Check if a conversation should auto-reopen when a run fires.
 */
export function shouldAutoReopen(record: ConversationRecord): boolean {
  return record.state === 'dormant';
}
