import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, type Stats, statSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

export type FileSystemSubject =
  | { type: 'core'; id: string }
  | { type: 'agent-run'; conversationId: string; runId: string }
  | { type: 'extension'; extensionId: string }
  | { type: 'automation'; taskId: string };

export type FileRootKind = 'workspace' | 'extension-storage' | 'artifact' | 'temp' | 'vault' | 'downloads' | 'secret';

export interface FileRootDescriptor {
  kind: FileRootKind;
  id: string;
  path: string;
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
  root: Pick<FileRootDescriptor, 'kind' | 'id' | 'displayName'>;
  operation: FileOperation;
  relativePath?: string;
  destinationPath?: string;
  outcome: 'success' | 'denied' | 'failed';
  policySource?: string;
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
  move(from: string, to: string, options?: { overwrite?: boolean }): Promise<void>;
  copyIn(to: string, absoluteSource: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  createDirectory(path: string): Promise<void>;
  resolvePath(path?: string | null): string;
  relativePath(absolutePath: string): string | null;
  createTempWorkspace(options?: { prefix?: string }): Promise<ScopedFileSystem>;
  runSync<T>(operation: FileOperation, input: { relativePath?: string; destinationPath?: string }, fn: () => T): T;
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
    readonly code: 'PATH_ESCAPE' | 'DENIED' | 'ASK_USER_UNSUPPORTED' | 'MISSING_ACCESS' | 'ROOT_NOT_FOUND',
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

function normalizeRootPath(path: string): string {
  return resolve(path);
}

function toEntryType(stats: Stats): FileEntryType {
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

export class FileSystemAuthority {
  private readonly hooks: FileSystemHook[] = [];
  private readonly auditSinks: Array<(event: FileAuditEvent) => void> = [];

  constructor(private readonly policy: FileSystemPolicy = { decide: () => ({ type: 'allow' }) }) {}

  registerHook(hook: FileSystemHook): { unregister: () => void } {
    this.hooks.push(hook);
    return { unregister: () => this.hooks.splice(this.hooks.indexOf(hook), 1) };
  }

  onAudit(sink: (event: FileAuditEvent) => void): { unsubscribe: () => void } {
    this.auditSinks.push(sink);
    return { unsubscribe: () => this.auditSinks.splice(this.auditSinks.indexOf(sink), 1) };
  }

  requestRootSync(input: RequestRootInput): ScopedFileSystem {
    const rootPath = normalizeRootPath(input.root.path);
    if (!existsSync(rootPath)) {
      throw new FileSystemAuthorityError(`Filesystem root does not exist: ${input.root.path}`, 'ROOT_NOT_FOUND');
    }
    return new NodeScopedFileSystem(this, input.subject, { ...input.root, path: rootPath }, [...new Set(input.access)], input.reason);
  }

  async requestRoot(input: RequestRootInput): Promise<ScopedFileSystem> {
    return this.requestRootSync(input);
  }

  async createTempRoot(input: Omit<RequestRootInput, 'root'> & { prefix?: string }): Promise<ScopedFileSystem> {
    const tempPath = await mkdtemp(join(tmpdir(), input.prefix ?? 'personal-agent-fs-'));
    return new NodeScopedFileSystem(
      this,
      input.subject,
      { kind: 'temp', id: tempPath, path: tempPath, displayName: 'Temporary workspace' },
      [...new Set(input.access)],
      input.reason,
    );
  }

  runSync<T>(ctx: Omit<FileOperationContext, 'requestId'>, fn: () => T): T {
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
      const policyDecision = this.policy.decide(operationCtx);
      if (policyDecision instanceof Promise) {
        throw new FileSystemAuthorityError('Async filesystem policy cannot run in a sync operation.', 'DENIED');
      }
      this.applyDecision(policyDecision, operationCtx);
      for (const hook of this.hooks) {
        const decision = hook.before?.(operationCtx);
        if (decision instanceof Promise) {
          throw new FileSystemAuthorityError('Async filesystem hook cannot run in a sync operation.', 'DENIED');
        }
        if (hook.id) wrapperIds.push(hook.id);
        this.applyDecision(decision, operationCtx);
      }
      const result = fn();
      this.audit(operationCtx, 'success', undefined, wrapperIds);
      for (const hook of this.hooks) {
        const after = hook.after?.({ ...operationCtx, outcome: 'success' });
        if (after instanceof Promise) void after;
      }
      return result;
    } catch (error) {
      const outcome = error instanceof FileSystemAuthorityError && error.code === 'DENIED' ? 'denied' : 'failed';
      this.audit(operationCtx, outcome, error, wrapperIds);
      for (const hook of this.hooks) {
        const after = hook.after?.({ ...operationCtx, outcome: 'failure', error });
        if (after instanceof Promise) void after;
      }
      throw error;
    }
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

  private applyDecision(decision: FilePolicyDecision | void, ctx: FileOperationContext): void {
    if (!decision || decision.type === 'allow') return;
    if (decision.type === 'deny') {
      throw new FileSystemAuthorityError(decision.reason, 'DENIED');
    }
    throw new FileSystemAuthorityError(`User approval required for ${ctx.operation}: ${decision.prompt}`, 'ASK_USER_UNSUPPORTED');
  }

  private audit(ctx: FileOperationContext, outcome: FileAuditEvent['outcome'], error?: unknown, wrapperIds?: string[]): void {
    const event: FileAuditEvent = {
      timestamp: new Date().toISOString(),
      requestId: ctx.requestId,
      subject: ctx.subject,
      root: { kind: ctx.root.kind, id: ctx.root.id, displayName: ctx.root.displayName },
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

class NodeScopedFileSystem implements ScopedFileSystem {
  constructor(
    private readonly authority: FileSystemAuthority,
    readonly subject: FileSystemSubject,
    readonly root: FileRootDescriptor,
    private readonly access: FileAccess[],
    private readonly reason: string,
  ) {}

  resolvePath(path?: string | null): string {
    const normalized = normalizeRelativePath(path);
    const absolute = resolve(this.root.path, normalized);
    const rootWithSep = this.root.path.endsWith(sep) ? this.root.path : `${this.root.path}${sep}`;
    if (absolute !== this.root.path && !absolute.startsWith(rootWithSep)) {
      throw new FileSystemAuthorityError('Path escapes workspace root', 'PATH_ESCAPE');
    }
    return absolute;
  }

  relativePath(absolutePath: string): string | null {
    const rel = relative(this.root.path, resolve(absolutePath)).replace(/\\/g, '/');
    if (!rel || rel === '.') return '';
    if (rel === '..' || rel.startsWith('../')) return null;
    return rel;
  }

  runSync<T>(operation: FileOperation, input: { relativePath?: string; destinationPath?: string }, fn: () => T): T {
    return this.authority.runSync(
      {
        subject: this.subject,
        root: this.root,
        operation,
        relativePath: input.relativePath !== undefined ? normalizeRelativePath(input.relativePath) : undefined,
        destinationPath: input.destinationPath !== undefined ? normalizeRelativePath(input.destinationPath) : undefined,
        access: this.access,
        reason: this.reason,
      },
      fn,
    );
  }

  async readBytes(path: string, options?: { maxBytes?: number }): Promise<Uint8Array> {
    const relativePath = normalizeRelativePath(path);
    return this.authority.run(
      { subject: this.subject, root: this.root, operation: 'read', relativePath, access: this.access, reason: this.reason },
      async () => {
        const buffer = await readFile(this.resolvePath(relativePath));
        if (options?.maxBytes !== undefined && buffer.byteLength > options.maxBytes) {
          throw new Error(`File is too large (${buffer.byteLength} bytes, max ${options.maxBytes}).`);
        }
        return buffer;
      },
    );
  }

  async readText(path: string, options?: { maxBytes?: number }): Promise<string> {
    return Buffer.from(await this.readBytes(path, options)).toString('utf-8');
  }

  async writeBytes(path: string, data: Uint8Array, options?: { atomic?: boolean }): Promise<void> {
    const relativePath = normalizeRelativePath(path);
    await this.authority.run(
      { subject: this.subject, root: this.root, operation: 'write', relativePath, access: this.access, reason: this.reason },
      async () => {
        const target = this.resolvePath(relativePath);
        await mkdir(dirname(target), { recursive: true });
        if (options?.atomic === false) {
          await writeFile(target, data);
          return;
        }
        const tmp = join(dirname(target), `.${basenameForTemp(target)}.${process.pid}.${Date.now()}.tmp`);
        await writeFile(tmp, data);
        await rename(tmp, target);
      },
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
    const relativePath = normalizeRelativePath(path);
    return this.authority.run(
      { subject: this.subject, root: this.root, operation: 'list', relativePath, access: this.access, reason: this.reason },
      async () => {
        const start = this.resolvePath(relativePath);
        const maxDepth = options?.depth ?? 0;
        const exclude = new Set(options?.excludeNames ?? []);
        const entries: FileEntry[] = [];
        const visit = async (directory: string, depth: number) => {
          for (const dirent of await readdir(directory, { withFileTypes: true })) {
            if (exclude.has(dirent.name)) continue;
            const fullPath = join(directory, dirent.name);
            const childRelative = this.relativePath(fullPath);
            if (childRelative === null) continue;
            const childStats = await stat(fullPath);
            const type = dirent.isDirectory()
              ? 'directory'
              : dirent.isFile()
                ? 'file'
                : dirent.isSymbolicLink()
                  ? 'symlink'
                  : toEntryType(childStats);
            entries.push({
              name: dirent.name,
              path: childRelative,
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
          entries.push({ name: relativePath.split('/').pop() ?? relativePath, path: relativePath, type: 'file', size: startStats.size });
        return entries;
      },
    );
  }

  async stat(path: string): Promise<FileStat> {
    const relativePath = normalizeRelativePath(path);
    return this.authority.run(
      { subject: this.subject, root: this.root, operation: 'metadata', relativePath, access: this.access, reason: this.reason },
      async () => {
        const stats = await stat(this.resolvePath(relativePath));
        return { type: toEntryType(stats), size: stats.isFile() ? stats.size : null, modifiedAt: stats.mtime.toISOString() };
      },
    );
  }

  async move(from: string, to: string, options?: { overwrite?: boolean }): Promise<void> {
    const relativePath = normalizeRelativePath(from);
    const destinationPath = normalizeRelativePath(to);
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
      async () => {
        const source = this.resolvePath(relativePath);
        const target = this.resolvePath(destinationPath);
        if (!options?.overwrite && existsSync(target)) throw new Error('Destination already exists');
        await mkdir(dirname(target), { recursive: true });
        await rename(source, target);
      },
    );
  }

  async copyIn(to: string, absoluteSource: string): Promise<void> {
    const relativePath = normalizeRelativePath(to);
    await this.authority.run(
      { subject: this.subject, root: this.root, operation: 'copy-in', relativePath, access: this.access, reason: this.reason },
      async () => {
        await this.writeBytes(relativePath, await readFile(absoluteSource));
      },
    );
  }

  async remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const relativePath = normalizeRelativePath(path);
    await this.authority.run(
      { subject: this.subject, root: this.root, operation: 'delete', relativePath, access: this.access, reason: this.reason },
      async () => {
        if (!relativePath) throw new Error('Refusing to delete filesystem root');
        await rm(this.resolvePath(relativePath), { recursive: options?.recursive ?? true, force: options?.force ?? false });
      },
    );
  }

  async createDirectory(path: string): Promise<void> {
    const relativePath = normalizeRelativePath(path);
    await this.authority.run(
      { subject: this.subject, root: this.root, operation: 'write', relativePath, access: this.access, reason: this.reason },
      async () => {
        if (!relativePath) throw new Error('path required');
        await mkdir(this.resolvePath(relativePath), { recursive: true });
      },
    );
  }

  async createTempWorkspace(options?: { prefix?: string }): Promise<ScopedFileSystem> {
    return this.authority.createTempRoot({ subject: this.subject, access: this.access, reason: this.reason, prefix: options?.prefix });
  }
}

function basenameForTemp(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 12);
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
      .catch(() => {
        // Best-effort observability only. Filesystem operations must not fail because event fanout is unavailable.
      });
  });
}

export function createCoreWorkspaceRoot(
  cwd: string,
  reason: string,
  access: FileAccess[] = ['read', 'list', 'metadata'],
): ScopedFileSystem {
  return defaultFileSystemAuthority.requestRootSync({
    subject: { type: 'core', id: 'workspace' },
    root: { kind: 'workspace', id: resolve(cwd), path: resolve(cwd), displayName: resolve(cwd) },
    access,
    reason,
  });
}

export function readFileSyncWithinRoot(root: ScopedFileSystem, path: string): Buffer {
  return readFileSync(root.resolvePath(path));
}

export function writeFileSyncWithinRoot(root: ScopedFileSystem, path: string, content: string | Buffer): void {
  const absolute = root.resolvePath(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

export function statSyncWithinRoot(root: ScopedFileSystem, path: string): Stats {
  return statSync(root.resolvePath(path));
}

export function readdirSyncWithinRoot(root: ScopedFileSystem, path: string) {
  return readdirSync(root.resolvePath(path), { withFileTypes: true });
}

export function removeSyncWithinRoot(root: ScopedFileSystem, path: string): void {
  const normalized = normalizeRelativePath(path);
  if (!normalized) throw new Error('Refusing to delete filesystem root');
  rmSync(root.resolvePath(normalized), { recursive: true, force: true });
}

export function renameSyncWithinRoot(root: ScopedFileSystem, from: string, to: string): void {
  const target = root.resolvePath(to);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(root.resolvePath(from), target);
}
