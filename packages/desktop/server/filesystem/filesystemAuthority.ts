import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

export type FileSystemSubject =
  | { type: 'core'; id: string }
  | { type: 'agent-run'; conversationId: string; runId: string }
  | { type: 'extension'; extensionId: string }
  | { type: 'automation'; taskId: string };

export type FileRootKind = 'workspace' | 'extension-storage' | 'artifact' | 'temp' | 'vault' | 'downloads' | 'secret';
export type FileProviderId = 'node' | string;

export interface FileRootDescriptor {
  kind: FileRootKind;
  id: string;
  path: string;
  provider?: FileProviderId;
  displayName?: string;
  labels?: Record<string, string>;
}

export type FileAccess = 'read' | 'write' | 'delete' | 'list' | 'move' | 'archive' | 'watch' | 'metadata';
export type FileOperation = 'read' | 'write' | 'delete' | 'list' | 'move' | 'copy-in' | 'archive-extract' | 'watch' | 'metadata';

export type FilePolicyDecision =
  | { type: 'allow' }
  | { type: 'deny'; reason: string }
  | { type: 'ask-user'; prompt: string; default?: 'deny' | 'allow' };

export interface FileOperationContext {
  subject: FileSystemSubject;
  root: FileRootDescriptor;
  operation: FileOperation;
  relativePath?: string;
  destinationPath?: string;
  access: FileAccess[];
  reason: string;
  requestId: string;
}

export interface FileSystemPolicy {
  decide(ctx: FileOperationContext): Promise<FilePolicyDecision> | FilePolicyDecision;
}

export interface FileSystemHook {
  id?: string;
  before?(ctx: FileOperationContext): Promise<FilePolicyDecision | void> | FilePolicyDecision | void;
  after?(ctx: FileOperationContext & { outcome: 'success' | 'failure'; error?: unknown }): Promise<void> | void;
}

export interface FileAuditEvent {
  timestamp: string;
  requestId: string;
  subject: FileSystemSubject;
  root: Pick<FileRootDescriptor, 'kind' | 'id' | 'displayName' | 'provider'>;
  operation: FileOperation;
  relativePath?: string;
  destinationPath?: string;
  outcome: 'success' | 'denied' | 'failed';
  wrapperIds?: string[];
  error?: string;
}

export type FileEntryType = 'file' | 'directory' | 'symlink' | 'other';
export interface FileEntry {
  name: string;
  path: string;
  type: FileEntryType;
  size?: number;
  modifiedAt?: string;
}
export interface FileStat {
  type: FileEntryType;
  size: number | null;
  modifiedAt: string | null;
}

export interface FileSystemBackend {
  id: FileProviderId;
  ensureRoot(root: FileRootDescriptor): Promise<FileRootDescriptor>;
  readBytes(root: FileRootDescriptor, path: string, options?: { maxBytes?: number }): Promise<Uint8Array>;
  writeBytes(root: FileRootDescriptor, path: string, data: Uint8Array, options?: { atomic?: boolean }): Promise<void>;
  list(root: FileRootDescriptor, path?: string, options?: { depth?: number; excludeNames?: string[] }): Promise<FileEntry[]>;
  stat(root: FileRootDescriptor, path: string): Promise<FileStat>;
  exists(root: FileRootDescriptor, path: string): Promise<boolean>;
  createDirectory(root: FileRootDescriptor, path: string): Promise<void>;
  move(root: FileRootDescriptor, from: string, to: string, options?: { overwrite?: boolean }): Promise<void>;
  copyIn(root: FileRootDescriptor, to: string, absoluteSource: string): Promise<void>;
  remove(root: FileRootDescriptor, path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  createTempRoot?(input: { prefix?: string }): Promise<FileRootDescriptor>;
}

export interface ScopedFileSystem {
  readonly root: FileRootDescriptor;
  readonly subject: FileSystemSubject;
  readBytes(path: string, options?: { maxBytes?: number }): Promise<Uint8Array>;
  readText(path: string, options?: { maxBytes?: number }): Promise<string>;
  writeBytes(path: string, data: Uint8Array, options?: { atomic?: boolean }): Promise<void>;
  writeText(path: string, data: string, options?: { atomic?: boolean }): Promise<void>;
  readJson<T>(path: string, options?: { maxBytes?: number }): Promise<T>;
  writeJson(path: string, value: unknown, options?: { atomic?: boolean }): Promise<void>;
  list(path?: string, options?: { depth?: number; excludeNames?: string[] }): Promise<FileEntry[]>;
  stat(path: string): Promise<FileStat>;
  exists(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<void>;
  move(from: string, to: string, options?: { overwrite?: boolean }): Promise<void>;
  copyIn(to: string, absoluteSource: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  createTempWorkspace(options?: { prefix?: string }): Promise<ScopedFileSystem>;
}

export interface RequestRootInput {
  subject: FileSystemSubject;
  root: FileRootDescriptor;
  access: FileAccess[];
  reason: string;
}

export class FileSystemAuthorityError extends Error {
  constructor(
    message: string,
    readonly code: 'PATH_ESCAPE' | 'DENIED' | 'ASK_USER_UNSUPPORTED' | 'MISSING_ACCESS' | 'ROOT_NOT_FOUND' | 'PROVIDER_NOT_FOUND',
  ) {
    super(message);
    this.name = 'FileSystemAuthorityError';
  }
}

function normalizeRelativePath(input: string | null | undefined): string {
  const trimmed = (input ?? '').replace(/\\/g, '/').trim();
  if (!trimmed || trimmed === '.') return '';
  return trimmed
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');
}

function assertRelativePath(path: string): string {
  const normalized = normalizeRelativePath(path);
  const absolute = resolve('/', normalized);
  if (absolute !== '/' && !absolute.startsWith(`/${normalized.split('/')[0] ?? ''}`)) {
    throw new FileSystemAuthorityError('Path escapes filesystem root', 'PATH_ESCAPE');
  }
  if (normalized.split('/').some((part) => part === '..')) {
    throw new FileSystemAuthorityError('Path escapes filesystem root', 'PATH_ESCAPE');
  }
  return normalized;
}

function toEntryType(stats: Awaited<ReturnType<typeof stat>>): FileEntryType {
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) return 'file';
  if (stats.isSymbolicLink()) return 'symlink';
  return 'other';
}

function accessForOperation(operation: FileOperation): FileAccess {
  switch (operation) {
    case 'read':
      return 'read';
    case 'write':
    case 'copy-in':
      return 'write';
    case 'delete':
      return 'delete';
    case 'list':
      return 'list';
    case 'move':
      return 'move';
    case 'archive-extract':
      return 'archive';
    case 'watch':
      return 'watch';
    case 'metadata':
      return 'metadata';
  }
}

function resolveNodePath(root: FileRootDescriptor, path?: string | null): string {
  const normalized = assertRelativePath(path ?? '');
  const rootPath = resolve(root.path);
  const absolute = resolve(rootPath, normalized);
  const rootWithSep = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;
  if (absolute !== rootPath && !absolute.startsWith(rootWithSep)) {
    throw new FileSystemAuthorityError('Path escapes filesystem root', 'PATH_ESCAPE');
  }
  return absolute;
}

class NodeFileSystemBackend implements FileSystemBackend {
  id = 'node';

  async ensureRoot(root: FileRootDescriptor): Promise<FileRootDescriptor> {
    const path = resolve(root.path);
    if (!existsSync(path)) throw new FileSystemAuthorityError(`Filesystem root does not exist: ${root.path}`, 'ROOT_NOT_FOUND');
    return { ...root, path, provider: root.provider ?? this.id };
  }

  async readBytes(root: FileRootDescriptor, path: string, options?: { maxBytes?: number }): Promise<Uint8Array> {
    const buffer = await readFile(resolveNodePath(root, path));
    if (options?.maxBytes !== undefined && buffer.byteLength > options.maxBytes) {
      throw new Error(`File is too large (${buffer.byteLength} bytes, max ${options.maxBytes}).`);
    }
    return buffer;
  }

  async writeBytes(root: FileRootDescriptor, path: string, data: Uint8Array, options?: { atomic?: boolean }): Promise<void> {
    const target = resolveNodePath(root, path);
    await mkdir(dirname(target), { recursive: true });
    if (options?.atomic === false) {
      await writeFile(target, data);
      return;
    }
    const tmp = join(dirname(target), `.pa-${process.pid}-${Date.now()}-${randomUUID()}.tmp`);
    await writeFile(tmp, data);
    await rename(tmp, target);
  }

  async list(root: FileRootDescriptor, path = '', options?: { depth?: number; excludeNames?: string[] }): Promise<FileEntry[]> {
    const start = resolveNodePath(root, path);
    const startRelative = assertRelativePath(path);
    const maxDepth = options?.depth ?? 0;
    const exclude = new Set(options?.excludeNames ?? []);
    const entries: FileEntry[] = [];
    const visit = async (directory: string, depth: number) => {
      for (const dirent of await readdir(directory, { withFileTypes: true })) {
        if (exclude.has(dirent.name)) continue;
        const fullPath = join(directory, dirent.name);
        const childStats = await stat(fullPath);
        const rel = relative(root.path, fullPath).replace(/\\/g, '/');
        const type = dirent.isDirectory()
          ? 'directory'
          : dirent.isFile()
            ? 'file'
            : dirent.isSymbolicLink()
              ? 'symlink'
              : toEntryType(childStats);
        entries.push({
          name: dirent.name,
          path: rel,
          type,
          ...(childStats.isFile() ? { size: childStats.size } : {}),
          modifiedAt: childStats.mtime.toISOString(),
        });
        if (dirent.isDirectory() && depth < maxDepth) await visit(fullPath, depth + 1);
      }
    };
    const startStats = await stat(start);
    if (startStats.isDirectory()) await visit(start, 0);
    else if (startStats.isFile())
      entries.push({ name: startRelative.split('/').pop() ?? startRelative, path: startRelative, type: 'file', size: startStats.size });
    return entries;
  }

  async stat(root: FileRootDescriptor, path: string): Promise<FileStat> {
    const stats = await stat(resolveNodePath(root, path));
    return { type: toEntryType(stats), size: stats.isFile() ? stats.size : null, modifiedAt: stats.mtime.toISOString() };
  }

  async exists(root: FileRootDescriptor, path: string): Promise<boolean> {
    try {
      await stat(resolveNodePath(root, path));
      return true;
    } catch {
      return false;
    }
  }

  async createDirectory(root: FileRootDescriptor, path: string): Promise<void> {
    const normalized = assertRelativePath(path);
    if (!normalized) throw new Error('path required');
    await mkdir(resolveNodePath(root, normalized), { recursive: true });
  }

  async move(root: FileRootDescriptor, from: string, to: string, options?: { overwrite?: boolean }): Promise<void> {
    const source = resolveNodePath(root, from);
    const target = resolveNodePath(root, to);
    if (!options?.overwrite && existsSync(target)) throw new Error('Destination already exists');
    await mkdir(dirname(target), { recursive: true });
    await rename(source, target);
  }

  async copyIn(root: FileRootDescriptor, to: string, absoluteSource: string): Promise<void> {
    await this.writeBytes(root, to, await readFile(absoluteSource));
  }

  async remove(root: FileRootDescriptor, path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const normalized = assertRelativePath(path);
    if (!normalized) throw new Error('Refusing to delete filesystem root');
    await rm(resolveNodePath(root, normalized), { recursive: options?.recursive ?? true, force: options?.force ?? false });
  }

  async createTempRoot(input: { prefix?: string }): Promise<FileRootDescriptor> {
    const tempPath = await mkdtemp(join(tmpdir(), input.prefix ?? 'personal-agent-fs-'));
    return { kind: 'temp', id: tempPath, path: tempPath, provider: this.id, displayName: 'Temporary workspace' };
  }
}

export class FileSystemAuthority {
  private readonly hooks: FileSystemHook[] = [];
  private readonly auditSinks: Array<(event: FileAuditEvent) => void> = [];
  private readonly providers = new Map<FileProviderId, FileSystemBackend>();

  constructor(private readonly policy: FileSystemPolicy = { decide: () => ({ type: 'allow' }) }) {
    this.registerProvider(new NodeFileSystemBackend());
  }

  registerProvider(provider: FileSystemBackend): { unregister: () => void } {
    if (this.providers.has(provider.id)) throw new Error(`Filesystem provider already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
    return { unregister: () => this.providers.delete(provider.id) };
  }

  registerHook(hook: FileSystemHook): { unregister: () => void } {
    this.hooks.push(hook);
    return { unregister: () => this.hooks.splice(this.hooks.indexOf(hook), 1) };
  }

  onAudit(sink: (event: FileAuditEvent) => void): { unsubscribe: () => void } {
    this.auditSinks.push(sink);
    return { unsubscribe: () => this.auditSinks.splice(this.auditSinks.indexOf(sink), 1) };
  }

  async requestRoot(input: RequestRootInput): Promise<ScopedFileSystem> {
    const provider = this.requireProvider(input.root.provider ?? 'node');
    const root = await provider.ensureRoot({ ...input.root, provider: provider.id });
    return new BackendScopedFileSystem(this, provider, input.subject, root, [...new Set(input.access)], input.reason);
  }

  async createTempRoot(input: Omit<RequestRootInput, 'root'> & { provider?: FileProviderId; prefix?: string }): Promise<ScopedFileSystem> {
    const provider = this.requireProvider(input.provider ?? 'node');
    if (!provider.createTempRoot) throw new Error(`Filesystem provider does not support temp roots: ${provider.id}`);
    const root = await provider.createTempRoot({ prefix: input.prefix });
    return new BackendScopedFileSystem(this, provider, input.subject, root, [...new Set(input.access)], input.reason);
  }

  async run<T>(ctx: Omit<FileOperationContext, 'requestId'>, fn: () => Promise<T>): Promise<T> {
    const requestId = randomUUID();
    const operationCtx: FileOperationContext = { ...ctx, requestId };
    const required = accessForOperation(ctx.operation);
    if (!ctx.access.includes(required)) {
      const error = new FileSystemAuthorityError(`Missing filesystem access ${required} for ${ctx.operation}.`, 'MISSING_ACCESS');
      this.audit(operationCtx, 'denied', error);
      throw error;
    }
    const wrapperIds: string[] = [];
    try {
      await this.applyDecision(await this.policy.decide(operationCtx), operationCtx);
      for (const hook of this.hooks) {
        const decision = await hook.before?.(operationCtx);
        if (hook.id) wrapperIds.push(hook.id);
        await this.applyDecision(decision, operationCtx);
      }
      const result = await fn();
      this.audit(operationCtx, 'success', undefined, wrapperIds);
      await Promise.all(this.hooks.map((hook) => hook.after?.({ ...operationCtx, outcome: 'success' })));
      return result;
    } catch (error) {
      const outcome = error instanceof FileSystemAuthorityError && error.code === 'DENIED' ? 'denied' : 'failed';
      this.audit(operationCtx, outcome, error, wrapperIds);
      await Promise.all(this.hooks.map((hook) => hook.after?.({ ...operationCtx, outcome: 'failure', error })));
      throw error;
    }
  }

  private requireProvider(id: FileProviderId): FileSystemBackend {
    const provider = this.providers.get(id);
    if (!provider) throw new FileSystemAuthorityError(`Filesystem provider not registered: ${id}`, 'PROVIDER_NOT_FOUND');
    return provider;
  }

  private async applyDecision(decision: FilePolicyDecision | void, ctx: FileOperationContext): Promise<void> {
    if (!decision || decision.type === 'allow') return;
    if (decision.type === 'deny') throw new FileSystemAuthorityError(decision.reason, 'DENIED');
    throw new FileSystemAuthorityError(`User approval required for ${ctx.operation}: ${decision.prompt}`, 'ASK_USER_UNSUPPORTED');
  }

  private audit(ctx: FileOperationContext, outcome: FileAuditEvent['outcome'], error?: unknown, wrapperIds?: string[]): void {
    const event: FileAuditEvent = {
      timestamp: new Date().toISOString(),
      requestId: ctx.requestId,
      subject: ctx.subject,
      root: { kind: ctx.root.kind, id: ctx.root.id, displayName: ctx.root.displayName, provider: ctx.root.provider },
      operation: ctx.operation,
      relativePath: ctx.relativePath,
      destinationPath: ctx.destinationPath,
      outcome,
      wrapperIds,
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    };
    for (const sink of this.auditSinks) sink(event);
  }
}

class BackendScopedFileSystem implements ScopedFileSystem {
  constructor(
    private readonly authority: FileSystemAuthority,
    private readonly backend: FileSystemBackend,
    readonly subject: FileSystemSubject,
    readonly root: FileRootDescriptor,
    private readonly access: FileAccess[],
    private readonly reason: string,
  ) {}

  async readBytes(path: string, options?: { maxBytes?: number }): Promise<Uint8Array> {
    const relativePath = assertRelativePath(path);
    return this.authority.run(
      { subject: this.subject, root: this.root, operation: 'read', relativePath, access: this.access, reason: this.reason },
      () => this.backend.readBytes(this.root, relativePath, options),
    );
  }

  async readText(path: string, options?: { maxBytes?: number }): Promise<string> {
    return Buffer.from(await this.readBytes(path, options)).toString('utf-8');
  }

  async writeBytes(path: string, data: Uint8Array, options?: { atomic?: boolean }): Promise<void> {
    const relativePath = assertRelativePath(path);
    await this.authority.run(
      { subject: this.subject, root: this.root, operation: 'write', relativePath, access: this.access, reason: this.reason },
      () => this.backend.writeBytes(this.root, relativePath, data, options),
    );
  }

  async writeText(path: string, data: string, options?: { atomic?: boolean }): Promise<void> {
    await this.writeBytes(path, Buffer.from(data, 'utf-8'), options);
  }

  async readJson<T>(path: string, options?: { maxBytes?: number }): Promise<T> {
    return JSON.parse(await this.readText(path, options)) as T;
  }

  async writeJson(path: string, value: unknown, options?: { atomic?: boolean }): Promise<void> {
    await this.writeText(path, `${JSON.stringify(value, null, 2)}\n`, options);
  }

  async list(path = '', options?: { depth?: number; excludeNames?: string[] }): Promise<FileEntry[]> {
    const relativePath = assertRelativePath(path);
    return this.authority.run(
      { subject: this.subject, root: this.root, operation: 'list', relativePath, access: this.access, reason: this.reason },
      () => this.backend.list(this.root, relativePath, options),
    );
  }

  async stat(path: string): Promise<FileStat> {
    const relativePath = assertRelativePath(path);
    return this.authority.run(
      { subject: this.subject, root: this.root, operation: 'metadata', relativePath, access: this.access, reason: this.reason },
      () => this.backend.stat(this.root, relativePath),
    );
  }

  async exists(path: string): Promise<boolean> {
    const relativePath = assertRelativePath(path);
    return this.authority.run(
      { subject: this.subject, root: this.root, operation: 'metadata', relativePath, access: this.access, reason: this.reason },
      () => this.backend.exists(this.root, relativePath),
    );
  }

  async createDirectory(path: string): Promise<void> {
    const relativePath = assertRelativePath(path);
    await this.authority.run(
      { subject: this.subject, root: this.root, operation: 'write', relativePath, access: this.access, reason: this.reason },
      () => this.backend.createDirectory(this.root, relativePath),
    );
  }

  async move(from: string, to: string, options?: { overwrite?: boolean }): Promise<void> {
    const relativePath = assertRelativePath(from);
    const destinationPath = assertRelativePath(to);
    await this.authority.run(
      {
        subject: this.subject,
        root: this.root,
        operation: 'move',
        relativePath,
        destinationPath,
        access: this.access,
        reason: this.reason,
      },
      () => this.backend.move(this.root, relativePath, destinationPath, options),
    );
  }

  async copyIn(to: string, absoluteSource: string): Promise<void> {
    const relativePath = assertRelativePath(to);
    await this.authority.run(
      { subject: this.subject, root: this.root, operation: 'copy-in', relativePath, access: this.access, reason: this.reason },
      () => this.backend.copyIn(this.root, relativePath, absoluteSource),
    );
  }

  async remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const relativePath = assertRelativePath(path);
    await this.authority.run(
      { subject: this.subject, root: this.root, operation: 'delete', relativePath, access: this.access, reason: this.reason },
      () => this.backend.remove(this.root, relativePath, options),
    );
  }

  async createTempWorkspace(options?: { prefix?: string }): Promise<ScopedFileSystem> {
    return this.authority.createTempRoot({
      subject: this.subject,
      access: this.access,
      reason: this.reason,
      provider: this.root.provider,
      prefix: options?.prefix,
    });
  }
}

export const defaultFileSystemAuthority = new FileSystemAuthority();

let hostEventAuditSinkRegistered = false;
export function registerFileSystemAuthorityHostEvents(): void {
  if (hostEventAuditSinkRegistered) return;
  hostEventAuditSinkRegistered = true;
  defaultFileSystemAuthority.onAudit((event) => {
    if (event.outcome !== 'success') return;
    if (!['write', 'delete', 'move', 'copy-in', 'archive-extract'].includes(event.operation)) return;
    void import('../extensions/extensionSubscriptions.js')
      .then(({ publishExtensionHostEvent }) => publishExtensionHostEvent('filesystem', event))
      .catch(() => {});
  });
}

export async function createCoreWorkspaceRoot(
  cwd: string,
  reason: string,
  access: FileAccess[] = ['read', 'list', 'metadata'],
): Promise<ScopedFileSystem> {
  return defaultFileSystemAuthority.requestRoot({
    subject: { type: 'core', id: 'workspace' },
    root: { kind: 'workspace', id: resolve(cwd), path: resolve(cwd), displayName: resolve(cwd), provider: 'node' },
    access,
    reason,
  });
}
