import { existsSync, readFileSync } from 'node:fs';
import { normalize, relative, resolve } from 'node:path';

import { readGitRepoInfo, readGitStatusSummary } from '../workspace/gitStatus.js';
import { extractTextFromMessageContent, getStableForkBranchEntries, type StableForkBranchEntry } from './liveSessionForking.js';
import {
  normalizeParallelPromptList,
  type ParallelPromptJob,
  type ParallelPromptJobStatus,
  readPersistedParallelJobs,
  truncateParallelPreviewText,
  writePersistedParallelJobs,
} from './liveSessionParallelJobs.js';
import { type DisplayBlock, readSessionBlocksByFile, readSessionMetaByFile } from './sessions.js';

const PARALLEL_RESULT_CUSTOM_TYPE = 'parallel_result';

export interface ParallelChildSessionSnapshot {
  sessionFile?: string;
  isStreaming: boolean;
}

export type ResolveParallelChildSession = (childConversationId: string) => ParallelChildSessionSnapshot | undefined;

export function readImportedParallelChildConversationIds(sessionFile: string): Set<string> {
  const imported = new Set<string>();

  try {
    const lines = readFileSync(sessionFile, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const rawLine = line.trim();
      if (!rawLine) {
        continue;
      }

      try {
        const entry = JSON.parse(rawLine) as {
          type?: string;
          display?: boolean;
          customType?: string;
          details?: { childConversationId?: unknown } | null;
        };
        if (entry.type !== 'custom_message' || entry.customType !== PARALLEL_RESULT_CUSTOM_TYPE) {
          continue;
        }

        const childConversationId = typeof entry.details?.childConversationId === 'string' ? entry.details.childConversationId.trim() : '';
        if (childConversationId) {
          imported.add(childConversationId);
        }
      } catch {
        continue;
      }
    }
  } catch {
    return imported;
  }

  return imported;
}

function normalizeParallelComparablePath(pathValue: string): string {
  return normalize(pathValue).replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeParallelTouchedPath(pathValue: string, input: { cwd?: string; repoRoot?: string } = {}): string {
  const normalized = pathValue.trim();
  if (!normalized) {
    return '';
  }

  if (input.repoRoot) {
    const absolutePath = normalized.startsWith('/') ? resolve(normalized) : input.cwd ? resolve(input.cwd, normalized) : null;
    if (absolutePath) {
      const relativePath = relative(input.repoRoot, absolutePath);
      if (relativePath && !relativePath.startsWith('..')) {
        return normalizeParallelComparablePath(relativePath);
      }
      if (relativePath === '') {
        return normalizeParallelComparablePath(absolutePath);
      }
      if (normalized.startsWith('/')) {
        return normalizeParallelComparablePath(absolutePath);
      }
    }
  }

  return normalizeParallelComparablePath(normalized);
}

function collectParallelToolCallPaths(argumentsValue: unknown): string[] {
  if (!argumentsValue || typeof argumentsValue !== 'object') {
    return [];
  }

  const args = argumentsValue as {
    path?: unknown;
    paths?: unknown;
    filePath?: unknown;
    filePaths?: unknown;
  };
  const paths = [
    typeof args.path === 'string' ? args.path.trim() : '',
    typeof args.filePath === 'string' ? args.filePath.trim() : '',
  ].filter((value): value is string => value.length > 0);

  const multiPaths = [args.paths, args.filePaths]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .flatMap((value): string[] => (typeof value === 'string' && value.trim().length > 0 ? [value.trim()] : []));

  return [...paths, ...multiPaths];
}

function collectParallelTouchedFilesFromBranchEntries(
  entries: StableForkBranchEntry[],
  options: { cwd?: string; repoRoot?: string; includeRead?: boolean } = {},
): string[] {
  const seen = new Set<string>();
  const touchedFiles: string[] = [];

  for (const entry of entries) {
    if (entry?.type !== 'message' || entry.message?.role !== 'assistant' || !Array.isArray(entry.message.content)) {
      continue;
    }

    for (const part of entry.message.content) {
      if (!part || typeof part !== 'object' || (part as { type?: unknown }).type !== 'toolCall') {
        continue;
      }

      const toolName = typeof (part as { name?: unknown }).name === 'string' ? (part as { name: string }).name.trim() : '';
      if (
        (toolName === 'read' && options.includeRead !== false) ||
        toolName === 'edit' ||
        toolName === 'write' ||
        toolName === 'checkpoint'
      ) {
        // keep going
      } else {
        continue;
      }

      for (const rawPath of collectParallelToolCallPaths((part as { arguments?: unknown }).arguments)) {
        const normalizedPath = normalizeParallelTouchedPath(rawPath, options);
        if (!normalizedPath || seen.has(normalizedPath)) {
          continue;
        }

        seen.add(normalizedPath);
        touchedFiles.push(normalizedPath);
      }
    }
  }

  return touchedFiles;
}

function readParallelTouchedFilesFromSessionFile(sessionFile: string, options: { cwd?: string; repoRoot?: string } = {}): string[] {
  return collectParallelTouchedFilesFromBranchEntries(getStableForkBranchEntries(sessionFile), options);
}

function readParallelMutatedFilesFromSessionFile(sessionFile: string, options: { cwd?: string; repoRoot?: string } = {}): string[] {
  return collectParallelTouchedFilesFromBranchEntries(getStableForkBranchEntries(sessionFile), {
    ...options,
    includeRead: false,
  });
}

function isParallelRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readParallelRecordString(value: Record<string, unknown> | null, key: string): string | null {
  const candidate = value?.[key];
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

function readParallelToolAction(block: Extract<DisplayBlock, { type: 'tool_use' }>): string | null {
  const details = isParallelRecord(block.details) ? block.details : null;
  const input = isParallelRecord(block.input) ? block.input : null;
  return readParallelRecordString(details, 'action') ?? readParallelRecordString(input, 'action');
}

function summarizeParallelToolOutput(block: Extract<DisplayBlock, { type: 'tool_use' }>): string | null {
  const firstLine = block.output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return null;
  }

  return truncateParallelPreviewText(firstLine, 200);
}

function isParallelSideEffectBlock(block: Extract<DisplayBlock, { type: 'tool_use' }>): boolean {
  const action = readParallelToolAction(block);

  if (block.tool === 'artifact') {
    return action === 'save' || action === 'delete';
  }

  if (block.tool === 'checkpoint') {
    return action === 'save';
  }

  if (block.tool === 'queue_followup') {
    return action === 'add' || action === 'cancel';
  }

  if (block.tool === 'scheduled_task') {
    return action === 'save' || action === 'delete' || action === 'run';
  }

  if (block.tool === 'run') {
    return action === 'start' || action === 'start_agent' || action === 'rerun' || action === 'follow_up' || action === 'cancel';
  }

  if (block.tool === 'change_working_directory') {
    return action === 'queue';
  }

  return false;
}

function readParallelSideEffectsFromSessionFile(sessionFile: string): string[] {
  const detail = readSessionBlocksByFile(sessionFile);
  const blocks = detail?.blocks ?? [];
  const seen = new Set<string>();
  const sideEffects: string[] = [];

  for (const block of blocks) {
    if (block.type !== 'tool_use' || !isParallelSideEffectBlock(block)) {
      continue;
    }

    const summary = summarizeParallelToolOutput(block);
    if (!summary || seen.has(summary)) {
      continue;
    }

    seen.add(summary);
    sideEffects.push(summary);
  }

  return sideEffects;
}

export function readParallelCurrentWorktreeDirtyPaths(cwd: string, repoRoot?: string): string[] {
  if (!cwd.trim()) {
    return [];
  }

  const resolvedRepoRoot = repoRoot?.trim() || readGitRepoInfo(cwd)?.root;
  if (!resolvedRepoRoot) {
    return [];
  }

  const summary = readGitStatusSummary(resolvedRepoRoot);
  if (!summary) {
    return [];
  }

  return normalizeParallelPromptList(
    summary.changes.map((change) => normalizeParallelComparablePath(change.relativePath)),
    256,
  );
}

function readParentTouchedFilesSinceFork(
  sessionFile: string,
  forkEntryId: string | undefined,
  options: { cwd?: string; repoRoot?: string; includeRead?: boolean } = {},
): string[] {
  const branch = getStableForkBranchEntries(sessionFile);
  if (!forkEntryId) {
    return collectParallelTouchedFilesFromBranchEntries(branch, options);
  }

  const forkIndex = branch.findIndex((entry) => entry.id?.trim() === forkEntryId);
  const branchTail = forkIndex >= 0 ? branch.slice(forkIndex + 1) : branch;
  return collectParallelTouchedFilesFromBranchEntries(branchTail, options);
}

function readParallelOverlapFiles(input: {
  mutatingChildFiles: string[];
  parentMutatingFiles: string[];
  currentDirtyPaths: string[];
  worktreeDirtyPathsAtStart: string[];
}): string[] {
  if (input.mutatingChildFiles.length === 0) {
    return [];
  }

  const startDirtyPaths = new Set(input.worktreeDirtyPathsAtStart);
  const concurrentDirtyPaths = input.currentDirtyPaths.filter((path) => !startDirtyPaths.has(path));
  const overlapCandidates = new Set<string>([
    ...normalizeParallelPromptList(input.parentMutatingFiles, 64),
    ...normalizeParallelPromptList(concurrentDirtyPaths, 128),
  ]);

  return input.mutatingChildFiles.filter((path) => overlapCandidates.has(path));
}

export function readParallelJobCompletionFromSessionFile(
  sessionFile: string,
  options: { cwd?: string; repoRoot?: string } = {},
): {
  hasTerminalReply: boolean;
  status?: Extract<ParallelPromptJobStatus, 'ready' | 'failed'>;
  resultText?: string;
  error?: string;
  touchedFiles: string[];
  sideEffects: string[];
} {
  const branch = getStableForkBranchEntries(sessionFile);
  const touchedFiles = readParallelTouchedFilesFromSessionFile(sessionFile, options);
  const sideEffects = readParallelSideEffectsFromSessionFile(sessionFile);

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== 'message' || entry.message?.role !== 'assistant') {
      continue;
    }

    if (entry.message.stopReason === 'toolUse') {
      continue;
    }

    if (entry.message.stopReason === 'error') {
      const errorMessage = entry.message.errorMessage?.trim();
      return {
        hasTerminalReply: true,
        status: 'failed',
        error: errorMessage && errorMessage.length > 0 ? errorMessage : 'The parallel prompt failed before completing.',
        touchedFiles,
        sideEffects,
      };
    }

    const resultText = extractTextFromMessageContent(entry.message.content);
    return {
      hasTerminalReply: true,
      status: 'ready',
      ...(resultText ? { resultText } : {}),
      touchedFiles,
      sideEffects,
    };
  }

  return {
    hasTerminalReply: false,
    touchedFiles,
    sideEffects,
  };
}

export function reconcileParallelPromptJob(
  sessionFile: string,
  job: ParallelPromptJob,
  resolveChildSession: ResolveParallelChildSession = () => undefined,
): ParallelPromptJob {
  const parentMeta = readSessionMetaByFile(sessionFile);
  const sourceCwd = parentMeta?.cwd ?? '';
  const repoRoot = sourceCwd ? job.repoRoot?.trim() || readGitRepoInfo(sourceCwd)?.root : job.repoRoot?.trim();
  const childSession = resolveChildSession(job.childConversationId);
  const childSessionFile = childSession?.sessionFile?.trim() || job.childSessionFile?.trim() || '';
  const updatedAt = new Date().toISOString();
  const parentTouchedFiles = readParentTouchedFilesSinceFork(sessionFile, job.forkEntryId, { cwd: sourceCwd, repoRoot });
  const parentMutatingFiles = readParentTouchedFilesSinceFork(sessionFile, job.forkEntryId, {
    cwd: sourceCwd,
    repoRoot,
    includeRead: false,
  });
  const currentDirtyPaths = readParallelCurrentWorktreeDirtyPaths(sourceCwd, repoRoot);
  const next: ParallelPromptJob = {
    ...job,
    ...(childSessionFile ? { childSessionFile } : {}),
    ...(repoRoot ? { repoRoot } : {}),
    updatedAt,
    touchedFiles: Array.isArray(job.touchedFiles) ? job.touchedFiles : [],
    parentTouchedFiles,
    overlapFiles: [],
    sideEffects: Array.isArray(job.sideEffects) ? job.sideEffects : [],
    worktreeDirtyPathsAtStart: normalizeParallelPromptList(job.worktreeDirtyPathsAtStart, 128),
  };

  if (childSession?.isStreaming) {
    next.status = 'running';
    next.overlapFiles = readParallelOverlapFiles({
      mutatingChildFiles:
        childSessionFile && existsSync(childSessionFile)
          ? readParallelMutatedFilesFromSessionFile(childSessionFile, { cwd: sourceCwd, repoRoot })
          : [],
      parentMutatingFiles,
      currentDirtyPaths,
      worktreeDirtyPathsAtStart: next.worktreeDirtyPathsAtStart,
    });
    return next;
  }

  if (childSessionFile && existsSync(childSessionFile)) {
    const completion = readParallelJobCompletionFromSessionFile(childSessionFile, { cwd: sourceCwd, repoRoot });
    next.touchedFiles = completion.touchedFiles;
    next.sideEffects = completion.sideEffects;
    next.overlapFiles = readParallelOverlapFiles({
      mutatingChildFiles: readParallelMutatedFilesFromSessionFile(childSessionFile, { cwd: sourceCwd, repoRoot }),
      parentMutatingFiles,
      currentDirtyPaths,
      worktreeDirtyPathsAtStart: next.worktreeDirtyPathsAtStart,
    });

    if (completion.status === 'failed') {
      next.status = 'failed';
      delete next.resultText;
      next.error = completion.error;
      return next;
    }

    if (completion.status === 'ready') {
      next.status = 'ready';
      next.resultText = completion.resultText ?? '';
      delete next.error;
      return next;
    }
  }

  next.overlapFiles = readParallelOverlapFiles({
    mutatingChildFiles: [],
    parentMutatingFiles,
    currentDirtyPaths,
    worktreeDirtyPathsAtStart: next.worktreeDirtyPathsAtStart,
  });

  if (next.status === 'importing') {
    next.status = next.error?.trim() ? 'failed' : 'ready';
    return next;
  }

  if (next.status === 'running') {
    next.status = 'failed';
    next.error = next.error?.trim() || 'Parallel prompt was interrupted before producing a final reply.';
  }

  return next;
}

export function reconcilePersistedParallelJobs(
  sessionFile: string,
  jobs: ParallelPromptJob[],
  resolveChildSession: ResolveParallelChildSession = () => undefined,
): ParallelPromptJob[] {
  const importedChildConversationIds = readImportedParallelChildConversationIds(sessionFile);
  return jobs
    .filter((job) => !importedChildConversationIds.has(job.childConversationId))
    .map((job) => reconcileParallelPromptJob(sessionFile, job, resolveChildSession));
}

export function replacePersistedParallelJob(
  sessionFile: string,
  jobId: string,
  updater: (job: ParallelPromptJob) => ParallelPromptJob | null,
  resolveChildSession: ResolveParallelChildSession = () => undefined,
): ParallelPromptJob[] {
  const jobs = readPersistedParallelJobs(sessionFile);
  const nextJobs: ParallelPromptJob[] = [];

  for (const job of jobs) {
    if (job.id !== jobId) {
      nextJobs.push(job);
      continue;
    }

    const updated = updater(job);
    if (updated) {
      nextJobs.push(updated);
    }
  }

  const reconciled = reconcilePersistedParallelJobs(sessionFile, nextJobs, resolveChildSession);
  writePersistedParallelJobs(sessionFile, reconciled);
  return reconciled;
}

export function loadPersistedParallelJobs(
  sessionFile: string | undefined,
  resolveChildSession: ResolveParallelChildSession = () => undefined,
): ParallelPromptJob[] {
  const normalizedSessionFile = sessionFile?.trim();
  if (!normalizedSessionFile) {
    return [];
  }

  const jobs = reconcilePersistedParallelJobs(normalizedSessionFile, readPersistedParallelJobs(normalizedSessionFile), resolveChildSession);
  writePersistedParallelJobs(normalizedSessionFile, jobs);
  return jobs;
}
