import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

export type ParallelPromptJobStatus = 'running' | 'ready' | 'failed' | 'importing';

export interface ParallelPromptPreview {
  id: string;
  prompt: string;
  childConversationId: string;
  status: ParallelPromptJobStatus;
  imageCount: number;
  attachmentRefs: string[];
  touchedFiles: string[];
  parentTouchedFiles: string[];
  overlapFiles: string[];
  sideEffects: string[];
  resultPreview?: string;
  error?: string;
}

export interface ParallelPromptJob {
  id: string;
  prompt: string;
  childConversationId: string;
  childSessionFile?: string;
  status: ParallelPromptJobStatus;
  createdAt: string;
  updatedAt: string;
  imageCount: number;
  attachmentRefs: string[];
  touchedFiles: string[];
  parentTouchedFiles: string[];
  overlapFiles: string[];
  sideEffects: string[];
  forkEntryId?: string;
  repoRoot?: string;
  worktreeDirtyPathsAtStart: string[];
  resultText?: string;
  error?: string;
}

const PARALLEL_JOBS_FILE_SUFFIX = '.parallel.json';
const PARALLEL_PREVIEW_PATH_LIMIT = 5;
const PARALLEL_PREVIEW_ATTACHMENT_LIMIT = 4;
const PARALLEL_PREVIEW_SIDE_EFFECT_LIMIT = 3;
const MAX_PARALLEL_PROMPT_IMAGE_COUNT = 100;

export function resolveParallelJobsFile(sessionFile: string): string {
  return `${sessionFile}${PARALLEL_JOBS_FILE_SUFFIX}`;
}

function normalizeParallelPromptJobStatus(value: unknown): ParallelPromptJobStatus {
  return value === 'ready' || value === 'failed' || value === 'importing' ? value : 'running';
}

function normalizeParallelPromptImageCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_PARALLEL_PROMPT_IMAGE_COUNT ? value : 0;
}

export function normalizeParallelPromptList(value: unknown, limit = 32): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const next: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    next.push(normalized);
    if (next.length >= limit) {
      break;
    }
  }

  return next;
}

function normalizeParallelPromptJob(candidate: unknown): ParallelPromptJob | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const job = candidate as Partial<ParallelPromptJob>;
  const id = typeof job.id === 'string' ? job.id.trim() : '';
  const prompt = typeof job.prompt === 'string' ? job.prompt : '';
  const childConversationId = typeof job.childConversationId === 'string' ? job.childConversationId.trim() : '';
  if (!id || !childConversationId) {
    return null;
  }

  const createdAt = typeof job.createdAt === 'string' && job.createdAt.trim().length > 0 ? job.createdAt.trim() : new Date().toISOString();
  const updatedAt = typeof job.updatedAt === 'string' && job.updatedAt.trim().length > 0 ? job.updatedAt.trim() : createdAt;
  const childSessionFile =
    typeof job.childSessionFile === 'string' && job.childSessionFile.trim().length > 0 ? job.childSessionFile.trim() : undefined;
  const forkEntryId = typeof job.forkEntryId === 'string' && job.forkEntryId.trim().length > 0 ? job.forkEntryId.trim() : undefined;
  const repoRoot = typeof job.repoRoot === 'string' && job.repoRoot.trim().length > 0 ? job.repoRoot.trim() : undefined;

  return {
    id,
    prompt,
    childConversationId,
    ...(childSessionFile ? { childSessionFile } : {}),
    status: normalizeParallelPromptJobStatus(job.status),
    createdAt,
    updatedAt,
    imageCount: normalizeParallelPromptImageCount(job.imageCount),
    attachmentRefs: normalizeParallelPromptList(job.attachmentRefs, 12),
    touchedFiles: normalizeParallelPromptList(job.touchedFiles, 24),
    parentTouchedFiles: normalizeParallelPromptList(job.parentTouchedFiles, 24),
    overlapFiles: normalizeParallelPromptList(job.overlapFiles, 24),
    sideEffects: normalizeParallelPromptList(job.sideEffects, 12),
    ...(forkEntryId ? { forkEntryId } : {}),
    ...(repoRoot ? { repoRoot } : {}),
    worktreeDirtyPathsAtStart: normalizeParallelPromptList(job.worktreeDirtyPathsAtStart, 128),
    ...(typeof job.resultText === 'string' && job.resultText.trim().length > 0 ? { resultText: job.resultText } : {}),
    ...(typeof job.error === 'string' && job.error.trim().length > 0 ? { error: job.error.trim() } : {}),
  };
}

export function readPersistedParallelJobs(sessionFile: string): ParallelPromptJob[] {
  const jobsFile = resolveParallelJobsFile(sessionFile);
  if (!existsSync(jobsFile)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(jobsFile, 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((candidate): ParallelPromptJob[] => {
      const normalized = normalizeParallelPromptJob(candidate);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

export function writePersistedParallelJobs(sessionFile: string, jobs: ParallelPromptJob[]): void {
  const jobsFile = resolveParallelJobsFile(sessionFile);
  if (jobs.length === 0) {
    if (existsSync(jobsFile)) {
      unlinkSync(jobsFile);
    }
    return;
  }

  writeFileSync(jobsFile, `${JSON.stringify(jobs, null, 2)}\n`);
}

export function truncateParallelPreviewText(text: string, maxLength = 240): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` : normalized;
}

function buildParallelPromptPreview(job: ParallelPromptJob): ParallelPromptPreview {
  const attachmentRefs = Array.isArray(job.attachmentRefs) ? job.attachmentRefs : [];
  const touchedFiles = Array.isArray(job.touchedFiles) ? job.touchedFiles : [];
  const parentTouchedFiles = Array.isArray(job.parentTouchedFiles) ? job.parentTouchedFiles : [];
  const overlapFiles = Array.isArray(job.overlapFiles) ? job.overlapFiles : [];
  const sideEffects = Array.isArray(job.sideEffects) ? job.sideEffects : [];
  return {
    id: job.id,
    prompt: truncateParallelPreviewText(job.prompt),
    childConversationId: job.childConversationId,
    status: job.status,
    imageCount: normalizeParallelPromptImageCount(job.imageCount),
    attachmentRefs: attachmentRefs.slice(0, PARALLEL_PREVIEW_ATTACHMENT_LIMIT),
    touchedFiles: touchedFiles.slice(0, PARALLEL_PREVIEW_PATH_LIMIT),
    parentTouchedFiles: parentTouchedFiles.slice(0, PARALLEL_PREVIEW_PATH_LIMIT),
    overlapFiles: overlapFiles.slice(0, PARALLEL_PREVIEW_PATH_LIMIT),
    sideEffects: sideEffects.slice(0, PARALLEL_PREVIEW_SIDE_EFFECT_LIMIT),
    ...(job.resultText ? { resultPreview: truncateParallelPreviewText(job.resultText) } : {}),
    ...(job.error ? { error: truncateParallelPreviewText(job.error) } : {}),
  };
}

export function readParallelState(jobs: ParallelPromptJob[] | undefined): ParallelPromptPreview[] {
  return (Array.isArray(jobs) ? jobs : []).map((job) => buildParallelPromptPreview(job));
}
