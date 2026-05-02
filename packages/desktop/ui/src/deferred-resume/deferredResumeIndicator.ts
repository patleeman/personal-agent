import type { DeferredResumeSummary } from '../shared/types';
import { buildDeferredResumeAutoResumeKey } from './deferredResumeAutoResume';

function parseIsoTimestamp(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return Number.NaN;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : Number.NaN;
}

function getDeferredResumeTargetMs(resume: DeferredResumeSummary): number {
  const parsed = parseIsoTimestamp(resume.status === 'ready'
    ? resume.readyAt ?? resume.dueAt
    : resume.dueAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function compareDeferredResumes(left: DeferredResumeSummary, right: DeferredResumeSummary): number {
  return getDeferredResumeTargetMs(left) - getDeferredResumeTargetMs(right);
}

export function describeDeferredResumeStatus(resume: DeferredResumeSummary, nowMs = Date.now()): string {
  if (resume.status === 'ready') {
    return 'ready now';
  }

  if (!Number.isSafeInteger(nowMs)) {
    return 'due now';
  }

  const deltaMs = parseIsoTimestamp(resume.dueAt) - nowMs;
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return 'due now';
  }

  const totalSeconds = Math.floor(deltaMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `in ${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `in ${minutes}m ${seconds}s`;
  }

  return `in ${seconds}s`;
}

export function buildDeferredResumeIndicatorText(resumes: DeferredResumeSummary[], nowMs: number): string {
  if (resumes.length === 0) {
    return 'none';
  }

  const readyCount = resumes.filter((resume) => resume.status === 'ready').length;
  if (readyCount > 0) {
    const scheduledCount = resumes.length - readyCount;
    if (scheduledCount > 0) {
      return `${readyCount} ready now · ${scheduledCount} scheduled`;
    }

    return readyCount === 1 ? '1 ready now' : `${readyCount} ready now`;
  }

  const nextResume = [...resumes].sort(compareDeferredResumes)[0];
  if (!nextResume) {
    return 'none';
  }

  const countLabel = resumes.length === 1 ? '1 scheduled' : `${resumes.length} scheduled`;
  return `${countLabel} · next ${describeDeferredResumeStatus(nextResume, nowMs)}`;
}

export function resolveDeferredResumePresentationState(input: {
  resumes: DeferredResumeSummary[];
  nowMs: number;
  isLiveSession: boolean;
  sessionFile?: string | null;
}): {
  orderedResumes: DeferredResumeSummary[];
  hasReadyResumes: boolean;
  autoResumeKey: string | null;
  indicatorText: string;
} {
  const orderedResumes = [...input.resumes].sort(compareDeferredResumes);
  return {
    orderedResumes,
    hasReadyResumes: orderedResumes.some((resume) => resume.status === 'ready'),
    autoResumeKey: buildDeferredResumeAutoResumeKey({
      resumes: orderedResumes,
      isLiveSession: input.isLiveSession,
      sessionFile: input.sessionFile,
    }),
    indicatorText: buildDeferredResumeIndicatorText(orderedResumes, input.nowMs),
  };
}

export function formatDeferredResumeWhen(resume: DeferredResumeSummary): string {
  const target = resume.status === 'ready'
    ? resume.readyAt ?? resume.dueAt
    : resume.dueAt;
  const date = new Date(target);
  if (Number.isNaN(date.getTime())) {
    return target;
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
