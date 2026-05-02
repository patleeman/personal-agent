import type { DeferredResumeSummary } from '../shared/types';

export function buildDeferredResumeAutoResumeKey(input: {
  resumes: DeferredResumeSummary[];
  isLiveSession: boolean;
  sessionFile?: string | null;
}): string | null {
  if (input.isLiveSession) {
    return null;
  }

  const sessionFile = input.sessionFile?.trim();
  if (!sessionFile) {
    return null;
  }

  const readyIds = input.resumes
    .filter((resume) => resume.status === 'ready' && resume.delivery?.autoResumeIfOpen !== false)
    .map((resume) => resume.id)
    .sort();

  if (readyIds.length === 0) {
    return null;
  }

  return `${sessionFile}::${readyIds.join(',')}`;
}

export function shouldAutoResumeDeferredResumes(input: {
  autoResumeKey: string | null;
  lastAttemptedKey: string | null;
  draft: boolean;
  isLiveSession: boolean;
  deferredResumesBusy: boolean;
  resumeConversationBusy: boolean;
}): boolean {
  if (input.draft || input.isLiveSession) {
    return false;
  }

  if (!input.autoResumeKey) {
    return false;
  }

  if (input.deferredResumesBusy || input.resumeConversationBusy) {
    return false;
  }

  return input.autoResumeKey !== input.lastAttemptedKey;
}
