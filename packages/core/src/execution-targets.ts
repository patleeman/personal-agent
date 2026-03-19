import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { getConfigRoot } from './runtime/paths.js';

const EXECUTION_TARGET_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const EXECUTION_TARGET_TRANSPORTS = ['ssh'] as const;

export type ExecutionTargetTransport = (typeof EXECUTION_TARGET_TRANSPORTS)[number];

export interface ExecutionTargetPathMapping {
  localPrefix: string;
  remotePrefix: string;
}

export interface ExecutionTargetRecord {
  id: string;
  label: string;
  description?: string;
  transport: ExecutionTargetTransport;
  sshDestination: string;
  sshCommand?: string;
  remotePaCommand?: string;
  profile?: string;
  defaultRemoteCwd?: string;
  commandPrefix?: string;
  cwdMappings: ExecutionTargetPathMapping[];
  createdAt: string;
  updatedAt: string;
}

interface ExecutionTargetsDocument {
  version: 1;
  targets: ExecutionTargetRecord[];
}

function getExecutionTargetsConfigRoot(configRoot?: string): string {
  return resolve(configRoot ?? getConfigRoot());
}

export function resolveExecutionTargetsFilePath(configRoot?: string): string {
  return join(getExecutionTargetsConfigRoot(configRoot), 'execution-targets.json');
}

export function validateExecutionTargetId(targetId: string): void {
  if (!EXECUTION_TARGET_ID_PATTERN.test(targetId)) {
    throw new Error(
      `Invalid execution target id "${targetId}". Target ids may only include letters, numbers, dots, dashes, and underscores.`,
    );
  }
}

function validateTransport(transport: string): asserts transport is ExecutionTargetTransport {
  if (!EXECUTION_TARGET_TRANSPORTS.includes(transport as ExecutionTargetTransport)) {
    throw new Error(`Invalid execution target transport "${transport}". Expected one of: ${EXECUTION_TARGET_TRANSPORTS.join(', ')}.`);
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

function normalizeLabel(value: unknown): string {
  const normalized = normalizeRequiredString(value, 'Execution target label');
  return normalized.replace(/\s+/g, ' ');
}

function normalizePath(value: unknown, label: string): string {
  const normalized = normalizeRequiredString(value, label);
  return normalized.replace(/\\/g, '/').replace(/\/$/, '') || '/';
}

function normalizePathMapping(value: unknown): ExecutionTargetPathMapping | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const mapping = value as Partial<ExecutionTargetPathMapping>;
  const localPrefix = normalizeOptionalString(mapping.localPrefix);
  const remotePrefix = normalizeOptionalString(mapping.remotePrefix);
  if (!localPrefix || !remotePrefix) {
    return null;
  }

  return {
    localPrefix: normalizePath(localPrefix, 'Execution target path mapping localPrefix'),
    remotePrefix: normalizePath(remotePrefix, 'Execution target path mapping remotePrefix'),
  };
}

function normalizePathMappings(value: unknown): ExecutionTargetPathMapping[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const mappings: ExecutionTargetPathMapping[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    const mapping = normalizePathMapping(entry);
    if (!mapping) {
      continue;
    }

    const key = `${mapping.localPrefix}=>${mapping.remotePrefix}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    mappings.push(mapping);
  }

  mappings.sort((left, right) => right.localPrefix.length - left.localPrefix.length || left.localPrefix.localeCompare(right.localPrefix));
  return mappings;
}

function normalizeExecutionTargetRecord(value: unknown): ExecutionTargetRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<ExecutionTargetRecord>;
  const id = normalizeOptionalString(record.id);
  const transport = normalizeOptionalString(record.transport);
  if (!id || !transport) {
    return null;
  }

  validateExecutionTargetId(id);
  validateTransport(transport);

  return {
    id,
    label: normalizeLabel(record.label),
    ...(normalizeOptionalString(record.description) ? { description: normalizeOptionalString(record.description) } : {}),
    transport,
    sshDestination: normalizeRequiredString(record.sshDestination, 'Execution target SSH destination'),
    ...(normalizeOptionalString(record.sshCommand) ? { sshCommand: normalizeOptionalString(record.sshCommand) } : {}),
    ...(normalizeOptionalString(record.remotePaCommand) ? { remotePaCommand: normalizeOptionalString(record.remotePaCommand) } : {}),
    ...(normalizeOptionalString(record.profile) ? { profile: normalizeOptionalString(record.profile) } : {}),
    ...(normalizeOptionalString(record.defaultRemoteCwd)
      ? { defaultRemoteCwd: normalizePath(record.defaultRemoteCwd, 'Execution target defaultRemoteCwd') }
      : {}),
    ...(normalizeOptionalString(record.commandPrefix) ? { commandPrefix: normalizeOptionalString(record.commandPrefix) } : {}),
    cwdMappings: normalizePathMappings(record.cwdMappings),
    createdAt: normalizeIsoTimestamp(record.createdAt, 'execution target createdAt'),
    updatedAt: normalizeIsoTimestamp(record.updatedAt, 'execution target updatedAt'),
  } satisfies ExecutionTargetRecord;
}

function emptyExecutionTargetsDocument(): ExecutionTargetsDocument {
  return {
    version: 1,
    targets: [],
  };
}

function normalizeExecutionTargetsDocument(value: unknown): ExecutionTargetsDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const document = value as Partial<ExecutionTargetsDocument>;
  if (document.version !== 1 || !Array.isArray(document.targets)) {
    return null;
  }

  const targets: ExecutionTargetRecord[] = [];
  const seen = new Set<string>();

  for (const entry of document.targets) {
    const target = normalizeExecutionTargetRecord(entry);
    if (!target || seen.has(target.id)) {
      continue;
    }

    seen.add(target.id);
    targets.push(target);
  }

  targets.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  return {
    version: 1,
    targets,
  };
}

function readExecutionTargetsDocument(path: string): ExecutionTargetsDocument {
  if (!existsSync(path)) {
    return emptyExecutionTargetsDocument();
  }

  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  const normalized = normalizeExecutionTargetsDocument(parsed);
  if (!normalized) {
    throw new Error(`Invalid execution targets document: ${path}`);
  }

  return normalized;
}

function writeExecutionTargetsDocument(path: string, document: ExecutionTargetsDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}

export function listExecutionTargets(options: { configRoot?: string } = {}): ExecutionTargetRecord[] {
  return readExecutionTargetsDocument(resolveExecutionTargetsFilePath(options.configRoot)).targets;
}

export function getExecutionTarget(options: { targetId: string; configRoot?: string }): ExecutionTargetRecord | null {
  validateExecutionTargetId(options.targetId);
  return listExecutionTargets({ configRoot: options.configRoot }).find((target) => target.id === options.targetId) ?? null;
}

export interface SaveExecutionTargetInput {
  id: string;
  label: string;
  description?: string;
  transport?: ExecutionTargetTransport;
  sshDestination: string;
  sshCommand?: string;
  remotePaCommand?: string;
  profile?: string;
  defaultRemoteCwd?: string;
  commandPrefix?: string;
  cwdMappings?: ExecutionTargetPathMapping[];
}

export function saveExecutionTarget(options: { configRoot?: string; target: SaveExecutionTargetInput }): ExecutionTargetRecord {
  validateExecutionTargetId(options.target.id);
  const path = resolveExecutionTargetsFilePath(options.configRoot);
  const document = readExecutionTargetsDocument(path);
  const existing = document.targets.find((target) => target.id === options.target.id);
  const now = new Date().toISOString();

  const target = normalizeExecutionTargetRecord({
    id: options.target.id,
    label: options.target.label,
    description: options.target.description,
    transport: options.target.transport ?? 'ssh',
    sshDestination: options.target.sshDestination,
    sshCommand: options.target.sshCommand,
    remotePaCommand: options.target.remotePaCommand,
    profile: options.target.profile,
    defaultRemoteCwd: options.target.defaultRemoteCwd,
    commandPrefix: options.target.commandPrefix,
    cwdMappings: options.target.cwdMappings ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  if (!target) {
    throw new Error('Invalid execution target payload.');
  }

  const nextTargets = document.targets.filter((candidate) => candidate.id !== target.id);
  nextTargets.push(target);
  nextTargets.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));

  writeExecutionTargetsDocument(path, {
    version: 1,
    targets: nextTargets,
  });

  return target;
}

export function deleteExecutionTarget(options: { targetId: string; configRoot?: string }): boolean {
  validateExecutionTargetId(options.targetId);
  const path = resolveExecutionTargetsFilePath(options.configRoot);
  if (!existsSync(path)) {
    return false;
  }

  const document = readExecutionTargetsDocument(path);
  const nextTargets = document.targets.filter((target) => target.id !== options.targetId);
  if (nextTargets.length === document.targets.length) {
    return false;
  }

  if (nextTargets.length === 0) {
    rmSync(path, { force: true });
    return true;
  }

  writeExecutionTargetsDocument(path, {
    version: 1,
    targets: nextTargets,
  });
  return true;
}
