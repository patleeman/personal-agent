import type { DeferredResumeSummary } from '../shared/types';

export function getDeferredResumeTargetMs(resume: DeferredResumeSummary): number {
  return Date.parse(resume.status === 'ready'
    ? resume.readyAt ?? resume.dueAt
    : resume.dueAt);
}

export function compareDeferredResumes(left: DeferredResumeSummary, right: DeferredResumeSummary): number {
  return getDeferredResumeTargetMs(left) - getDeferredResumeTargetMs(right);
}

export function describeDeferredResumeStatus(resume: DeferredResumeSummary, nowMs = Date.now()): string {
  if (resume.status === 'ready') {
    return 'ready now';
  }

  const deltaMs = Date.parse(resume.dueAt) - nowMs;
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
