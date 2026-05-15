# Filesystem Authority

Personal Agent should route host-owned filesystem access through a shared Filesystem Authority, the same way host-owned process execution routes through the shared process launcher. The goal is one product boundary for workspace files, extension storage files, artifacts, temp workspaces, archive extraction, and future command sandbox root grants.

## Problem

The risky shape is trusted code acting on untrusted path strings:

- agent tools receive model-proposed paths;
- extensions receive UI/user/tool paths;
- archives contain attacker-controlled entry names;
- generated filenames come from prompts, web pages, or protocol payloads;
- command sandboxes need a coherent list of allowed roots.

`path.resolve(root, input).startsWith(root)` only validates a string. It does not pin the opened file, protect against symlink retargeting between check and use, reject hardlinked aliases, or verify that atomic writes landed where intended. Duplicating those checks across features creates a security boundary made of vibes. Bad boundary. Into the volcano.

## Finished-state principle

Any file operation whose path is addressed by a user, agent, extension, imported archive, or external protocol goes through the Filesystem Authority. Callers receive capabilities to scoped roots, not ambient filesystem power.

```ts
const workspace = await ctx.filesystem.requestRoot({
  subject: ctx.subject,
  root: { kind: 'workspace', id: conversationId, path: cwd },
  access: ['read', 'write'],
  reason: 'apply model edit',
});

await workspace.writeText('notes/today.md', text);
```

Raw `node:fs` remains acceptable for code-owned internal implementation details, migrations, tests, and low-level backends. It is not acceptable for scoped workspace/extension/user-facing paths once this boundary exists.

## Layering

```txt
extension/core call site
        │
        ▼
FileSystemAuthority  ── root registry, subject identity, grants
        │
        ▼
FileSystemPolicy     ── allow/deny/ask decisions
        │
        ▼
FileSystemHooks      ── extension and core interception points
        │
        ▼
ScopedFileSystem     ── read/write/list/move/remove/archive APIs
        │
        ▼
FilesystemBackend    ── current Node backend; fs-safe can be plugged in later
        │
        ▼
node filesystem
```

The backend is deliberately hidden behind our interface. The first implementation uses Node filesystem primitives with a single scoped boundary. `@openclaw/fs-safe` remains a future backend/plugin candidate, not a dependency or public API.

## Core types

```ts
type FileSystemSubject =
  | { type: 'core'; id: string }
  | { type: 'agent-run'; conversationId: string; runId: string }
  | { type: 'extension'; extensionId: string }
  | { type: 'automation'; taskId: string };

type FileRootKind = 'workspace' | 'extension-storage' | 'artifact' | 'temp' | 'vault' | 'downloads' | 'secret';

interface FileRootDescriptor {
  kind: FileRootKind;
  id: string;
  path: string; // absolute host path, resolved by host only
  displayName?: string;
  labels?: Record<string, string>;
}

type FileAccess = 'read' | 'write' | 'delete' | 'list' | 'move' | 'archive' | 'watch' | 'metadata';

interface RequestRootInput {
  subject: FileSystemSubject;
  root: FileRootDescriptor;
  access: FileAccess[];
  reason: string;
  policy?: {
    symlinks?: 'reject' | 'allow-in-root';
    hardlinks?: 'reject' | 'allow';
    maxFileBytes?: number;
    allowedGlobs?: string[];
    deniedGlobs?: string[];
  };
}

interface ScopedFileSystem {
  readonly root: FileRootDescriptor;
  readonly subject: FileSystemSubject;
  readBytes(path: string, options?: ReadOptions): Promise<Uint8Array>;
  readText(path: string, options?: ReadTextOptions): Promise<string>;
  writeBytes(path: string, data: Uint8Array, options?: WriteOptions): Promise<void>;
  writeText(path: string, data: string, options?: WriteOptions): Promise<void>;
  readJson<T>(path: string, options?: JsonReadOptions): Promise<T>;
  writeJson(path: string, value: unknown, options?: JsonWriteOptions): Promise<void>;
  list(path?: string, options?: ListOptions): Promise<FileEntry[]>;
  stat(path: string): Promise<FileStat>;
  move(from: string, to: string, options?: MoveOptions): Promise<void>;
  copyIn(to: string, absoluteSource: string, options?: CopyInOptions): Promise<void>;
  remove(path: string, options?: RemoveOptions): Promise<void>;
  extractArchive(archivePath: string, destination: string, options?: ArchiveOptions): Promise<ArchiveExtractResult>;
  createTempWorkspace(options?: TempWorkspaceOptions): Promise<ScopedFileSystem>;
}
```

The public extension SDK should expose `ctx.filesystem` and keep `ctx.workspace` as a convenience wrapper over `ctx.filesystem.requestRoot({ root: currentWorkspace })`.

## Policy and hooks

Policy answers whether a subject may do an operation. Hooks observe or wrap the operation. They should mirror the process-wrapper model, but file hooks need typed decisions because file operations are smaller and more numerous than process launches.

```ts
type FileOperation = 'read' | 'write' | 'delete' | 'list' | 'move' | 'copy-in' | 'archive-extract' | 'watch' | 'metadata';

type FilePolicyDecision =
  | { type: 'allow' }
  | { type: 'deny'; reason: string }
  | { type: 'ask-user'; prompt: string; default?: 'deny' | 'allow' };

interface FileOperationContext {
  subject: FileSystemSubject;
  root: FileRootDescriptor;
  operation: FileOperation;
  relativePath?: string;
  destinationPath?: string;
  access: FileAccess[];
  reason: string;
  requestId: string;
}

interface FileSystemPolicy {
  decide(ctx: FileOperationContext): Promise<FilePolicyDecision> | FilePolicyDecision;
}

interface FileSystemHook {
  before?(ctx: FileOperationContext): Promise<FilePolicyDecision | void> | FilePolicyDecision | void;
  after?(ctx: FileOperationContext & { outcome: 'success' | 'failure'; error?: unknown }): Promise<void> | void;
}
```

Rules:

- `deny` fails closed with a typed `FileSystemAuthorityError`.
- `ask-user` is allowed only on interactive surfaces; background tasks must default according to policy.
- Path rewriting is intentionally excluded from v1. It is powerful, confusing, and smells like a future incident report.
- Hooks run in registration order, record their wrapper/extension ids, and surface that metadata in audit/UI events.

## Root registry and grants

The authority owns all root construction. Callers do not pass arbitrary absolute paths around after the root is granted.

Initial root kinds:

| Kind                | Owner                                | Default policy                                                                         |
| ------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| `workspace`         | conversation/workspace runtime       | read/list, write/delete only for agent/tool surfaces that already have write authority |
| `extension-storage` | extension host                       | private to one extension, read/write, no cross-extension access                        |
| `artifact`          | artifacts extension/core export flow | write through artifact APIs, read for rendering/export                                 |
| `temp`              | runtime                              | private 0700 scratch, cleaned by lifecycle owner                                       |
| `vault`             | knowledge extension                  | explicit read/write grants; never ambient for arbitrary extensions                     |
| `downloads`         | browser/import flows                 | staged writes then explicit copy into workspace/artifact roots                         |
| `secret`            | secrets/credentials surfaces         | opt-in only, strict modes, no list by default                                          |

Grants become the shared language with command sandboxing:

```ts
interface AuthorityGrant {
  subject: FileSystemSubject;
  root: FileRootDescriptor;
  access: FileAccess[];
  expiresAt?: string;
  source: 'manifest' | 'conversation' | 'user-approval' | 'core';
}
```

A bash sandbox wrapper can consume the same grants to decide which roots to mount or expose. Direct file APIs and process execution then agree on the same authority model.

## Extension manifest and SDK direction

Existing permissions are intent declarations. The finished state should make filesystem intent explicit:

```json
{
  "permissions": ["filesystem:workspace:read", "filesystem:workspace:write", "filesystem:extension-storage:readwrite"]
}
```

Suggested SDK:

```ts
await ctx.filesystem.workspace({ access: ['read'], reason: 'index files' });
await ctx.filesystem.extensionStorage({ access: ['read', 'write'], reason: 'cache API result' });
await ctx.filesystem.temp({ reason: 'render preview' });
```

`ctx.storage` remains SQLite key-value state. `ctx.filesystem.extensionStorage()` is for real files/blobs managed under the extension's private root.

## Backend behavior

The backend should use defaults that match product safety, not maximum compatibility. Today that means the Node backend owns root scoping, access checks, policy hooks, audit events, and atomic writes where it performs writes. A future fs-safe backend should preserve the same authority contract and can harden these primitives further:

- reject symlinks unless a root kind explicitly allows in-root symlinks;
- reject hardlinks for writable untrusted roots;
- use atomic writes for writes and JSON writes;
- use private temp workspaces for staging;
- use archive extraction count, byte, path, symlink, and link limits;
- verify writes land under the scoped root;
- return typed errors with both policy and operational categories.

If a backend cannot express a policy cleanly, the authority owns the missing product behavior above it rather than leaking backend quirks upward.

## Events, audit, and UI

Every mutating operation should emit a host event and an audit record:

```ts
interface FileAuditEvent {
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
}
```

This should feed existing workspace file events (`host:workspaceFiles`) instead of creating parallel realities. Tool UI should show when a filesystem wrapper/policy handled an operation, matching the sandboxing visibility contract.

## Migration target

Converge these surfaces on the authority:

- agent file tools: read, write, edit, checkpoint-adjacent file collection;
- file explorer APIs: tree, file read, create, rename, move, delete;
- extension `ctx.workspace` and future `ctx.filesystem`;
- extension private file storage;
- artifact writes and exports;
- browser/download/import staging;
- archive extraction;
- temp workspace creation;
- knowledge vault file access;
- command sandbox root grants.

Avoid a half migration where some paths use the authority and equivalent paths bypass it. The repo should eventually have a lint/build guard for direct `node:fs` use in extension backend code and for workspace-facing server modules, with explicit low-level-backend allowlists.

## Non-goals

- This is not a hostile-code sandbox. Extensions with arbitrary native code or shell access still need process isolation or command sandboxing.
- This does not replace OS permissions, containers, seccomp, or macOS sandboxing.
- This does not make raw bash safe. It gives bash sandboxing the same root/grant vocabulary as direct file APIs.
- This should not expose `@openclaw/fs-safe` directly as the extension API.

## Implementation phases aimed at the finished state

The implementation can land in slices, but each slice should preserve the final architecture:

1. Add `packages/core/src/filesystem-authority` interfaces, errors, audit event types, and an in-process authority implementation.
2. Add `FsSafeBackend` and package dependency.
3. Wire extension backend `ctx.filesystem`; reimplement `ctx.workspace` on top of it.
4. Move server workspace/file-explorer APIs onto the authority.
5. Move artifact/temp/archive/vault file operations onto dedicated root kinds.
6. Feed file audit events into the host event bus and workspace file subscriptions.
7. Connect process wrappers/sandboxing to authority grants.
8. Add build/lint guards against new direct scoped-path `node:fs` usage outside low-level backends.

The target is boring: one boundary, one policy vocabulary, one audit trail. Boring is good. Boring means the ogre is cooked all the way through.
