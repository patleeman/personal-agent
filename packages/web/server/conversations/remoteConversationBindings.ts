import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getStateRoot } from '@personal-agent/core';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

export interface RemoteConversationBinding {
  version: 1;
  conversationId: string;
  targetId: string;
  remoteCwd: string;
  localSessionFile: string;
  remoteSessionFile?: string;
  updatedAt: string;
}

function validateProfileName(profile: string): void {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(`Invalid profile name "${profile}".`);
  }
}

function validateConversationId(conversationId: string): void {
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
    throw new Error(`Invalid conversation id "${conversationId}".`);
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function normalizeIsoTimestamp(value: unknown, label: string): string {
  const normalized = normalizeRequiredString(value, label);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${normalized}`);
  }

  return new Date(parsed).toISOString();
}

function normalizePath(value: unknown, label: string): string {
  return normalizeRequiredString(value, label).replace(/\\/g, '/');
}

function normalizeBinding(value: unknown): RemoteConversationBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<RemoteConversationBinding>;
  const conversationId = normalizeOptionalString(record.conversationId);
  const targetId = normalizeOptionalString(record.targetId);
  if (!conversationId || !targetId) {
    return null;
  }

  validateConversationId(conversationId);

  return {
    version: 1,
    conversationId,
    targetId,
    remoteCwd: normalizePath(record.remoteCwd, 'remote conversation remoteCwd'),
    localSessionFile: normalizePath(record.localSessionFile, 'remote conversation localSessionFile'),
    ...(normalizeOptionalString(record.remoteSessionFile)
      ? { remoteSessionFile: normalizePath(record.remoteSessionFile, 'remote conversation remoteSessionFile') }
      : {}),
    updatedAt: normalizeIsoTimestamp(record.updatedAt, 'remote conversation updatedAt'),
  };
}

function resolveBindingsRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
}

export function resolveRemoteConversationBindingsDir(options: { profile: string; stateRoot?: string }): string {
  validateProfileName(options.profile);
  return join(resolveBindingsRoot(options.stateRoot), 'pi-agent', 'state', 'remote-conversations', options.profile);
}

export function resolveRemoteConversationBindingPath(options: { profile: string; conversationId: string; stateRoot?: string }): string {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  return join(resolveRemoteConversationBindingsDir(options), `${options.conversationId}.json`);
}

export function getRemoteConversationBinding(options: { profile: string; conversationId: string; stateRoot?: string }): RemoteConversationBinding | null {
  const path = resolveRemoteConversationBindingPath(options);
  if (!existsSync(path)) {
    return null;
  }

  const normalized = normalizeBinding(JSON.parse(readFileSync(path, 'utf-8')) as unknown);
  if (!normalized) {
    throw new Error(`Invalid remote conversation binding: ${path}`);
  }

  return normalized;
}

export function setRemoteConversationBinding(options: {
  profile: string;
  conversationId: string;
  targetId: string;
  remoteCwd: string;
  localSessionFile: string;
  remoteSessionFile?: string | null;
  updatedAt?: string;
  stateRoot?: string;
}): RemoteConversationBinding {
  const path = resolveRemoteConversationBindingPath(options);
  const document: RemoteConversationBinding = {
    version: 1,
    conversationId: normalizeRequiredString(options.conversationId, 'conversationId'),
    targetId: normalizeRequiredString(options.targetId, 'targetId'),
    remoteCwd: normalizePath(options.remoteCwd, 'remoteCwd'),
    localSessionFile: normalizePath(options.localSessionFile, 'localSessionFile'),
    ...(normalizeOptionalString(options.remoteSessionFile ?? undefined)
      ? { remoteSessionFile: normalizePath(options.remoteSessionFile, 'remoteSessionFile') }
      : {}),
    updatedAt: normalizeIsoTimestamp(options.updatedAt ?? new Date().toISOString(), 'remote conversation updatedAt'),
  };

  mkdirSync(resolveRemoteConversationBindingsDir(options), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  return document;
}

export function deleteRemoteConversationBinding(options: { profile: string; conversationId: string; stateRoot?: string }): void {
  rmSync(resolveRemoteConversationBindingPath(options), { force: true });
}
