import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { validateConversationId } from './conversation-project-links.js';
import { getStateRoot } from './runtime/paths.js';
import { validateExecutionTargetId } from './execution-targets.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

export interface ResolveConversationExecutionTargetOptions {
  profile: string;
  stateRoot?: string;
}

export interface ResolveConversationExecutionTargetPathOptions extends ResolveConversationExecutionTargetOptions {
  conversationId: string;
}

export interface ConversationExecutionTargetDocument {
  conversationId: string;
  updatedAt: string;
  targetId: string;
}

function getConversationExecutionTargetStateRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
}

function validateProfileName(profile: string): void {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(
      `Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`,
    );
  }
}

function normalizeIsoTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return new Date(parsed).toISOString();
}

export function resolveProfileConversationExecutionTargetsDir(options: ResolveConversationExecutionTargetOptions): string {
  validateProfileName(options.profile);
  return join(
    getConversationExecutionTargetStateRoot(options.stateRoot),
    'pi-agent',
    'state',
    'conversation-execution-targets',
    options.profile,
  );
}

export function resolveConversationExecutionTargetPath(options: ResolveConversationExecutionTargetPathOptions): string {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  return join(resolveProfileConversationExecutionTargetsDir(options), `${options.conversationId}.json`);
}

export function readConversationExecutionTarget(path: string): ConversationExecutionTargetDocument {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ConversationExecutionTargetDocument>;
  const conversationId = typeof parsed.conversationId === 'string' ? parsed.conversationId.trim() : '';
  const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt.trim() : '';
  const targetId = typeof parsed.targetId === 'string' ? parsed.targetId.trim() : '';

  validateConversationId(conversationId);
  validateExecutionTargetId(targetId);
  if (updatedAt.length === 0) {
    throw new Error(`Invalid conversation execution target updatedAt in ${path}`);
  }

  return {
    conversationId,
    updatedAt: normalizeIsoTimestamp(updatedAt, 'conversation execution target updatedAt'),
    targetId,
  };
}

export function getConversationExecutionTarget(options: ResolveConversationExecutionTargetPathOptions): ConversationExecutionTargetDocument | null {
  const path = resolveConversationExecutionTargetPath(options);
  if (!existsSync(path)) {
    return null;
  }

  return readConversationExecutionTarget(path);
}

export function setConversationExecutionTarget(options: {
  stateRoot?: string;
  profile: string;
  conversationId: string;
  targetId: string | null;
  updatedAt?: string;
}): ConversationExecutionTargetDocument | null {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);

  const path = resolveConversationExecutionTargetPath({
    stateRoot: options.stateRoot,
    profile: options.profile,
    conversationId: options.conversationId,
  });

  if (options.targetId === null) {
    rmSync(path, { force: true });
    return null;
  }

  validateExecutionTargetId(options.targetId);

  const document: ConversationExecutionTargetDocument = {
    conversationId: options.conversationId,
    updatedAt: normalizeIsoTimestamp(options.updatedAt ?? new Date().toISOString(), 'conversation execution target updatedAt'),
    targetId: options.targetId,
  };

  mkdirSync(resolveProfileConversationExecutionTargetsDir({ stateRoot: options.stateRoot, profile: options.profile }), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  return document;
}
