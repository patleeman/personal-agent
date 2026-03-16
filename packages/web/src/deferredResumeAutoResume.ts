import type { DeferredResumeSummary } from './types';

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
    .filter((resume) => resume.status === 'ready')
    .map((resume) => resume.id)
    .sort();

  if (readyIds.length === 0) {
    return null;
  }

  return `${sessionFile}::${readyIds.join(',')}`;
}
