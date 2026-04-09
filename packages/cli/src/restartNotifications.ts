import {
  createProjectActivityEntry,
  writeProfileActivityEntry,
} from '@personal-agent/core';
import { getWebUiServiceStatus } from '@personal-agent/services';
import { getRepoRoot } from '@personal-agent/resources';

export interface RestartCompletionInboxEntryInput {
  profile: string;
  repoRoot?: string;
  stateRoot?: string;
  requestedAt?: string;
  daemonStatus: string;
  webUiStatus: string;
}

export interface RestartFailureInboxEntryInput {
  profile: string;
  repoRoot?: string;
  stateRoot?: string;
  requestedAt?: string;
  phase?: string;
  error: string;
}

export interface UpdateCompletionInboxEntryInput {
  profile: string;
  repoRoot?: string;
  stateRoot?: string;
  requestedAt?: string;
  daemonStatus: string;
  webUiStatus: string;
}

export interface UpdateFailureInboxEntryInput {
  profile: string;
  repoRoot?: string;
  stateRoot?: string;
  requestedAt?: string;
  phase?: string;
  error: string;
}

function sanitizeActivityIdSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return normalized.length > 0 ? normalized : 'item';
}

function buildTimestampKey(value: string): string {
  return sanitizeActivityIdSegment(value.replace(/[.:]/g, '-'));
}

function resolveEffectiveRepoRoot(repoRoot?: string): string {
  return getRepoRoot(repoRoot);
}

function resolveEffectiveActivityStateRoot(stateRoot?: string): string | undefined {
  const explicit = stateRoot?.trim();
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  const fromEnv = process.env.PERSONAL_AGENT_OPERATIONAL_ACTIVITY_STATE_ROOT?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

function readWebUiContext(repoRoot: string): {
  activeRevision?: string;
  serviceUrl?: string;
  serviceInspectionError?: string;
} {
  try {
    const serviceStatus = getWebUiServiceStatus({ repoRoot });
    return {
      activeRevision: serviceStatus.deployment?.activeRelease?.revision,
      serviceUrl: serviceStatus.url,
    };
  } catch (error) {
    return {
      serviceInspectionError: error instanceof Error ? error.message : String(error),
    };
  }
}

function writeDeploymentInboxEntry(input: {
  repoRoot: string;
  stateRoot?: string;
  profile: string;
  createdAt: string;
  idPrefix: string;
  summary: string;
  details: string[];
}): string {
  return writeProfileActivityEntry({
    stateRoot: input.stateRoot,
    profile: input.profile,
    repoRoot: input.repoRoot,
    entry: createProjectActivityEntry({
      id: `${input.idPrefix}-${buildTimestampKey(input.createdAt)}`,
      createdAt: input.createdAt,
      profile: input.profile,
      kind: 'deployment',
      summary: input.summary,
      details: input.details.join('\n'),
      notificationState: 'none',
    }),
  });
}

function buildApplicationSummary(prefix: string, revision?: string): string {
  const parts = [prefix];

  if (revision && revision.trim().length > 0) {
    parts.push(revision.trim());
  }

  return parts.join(' · ');
}

function buildApplicationCompletionDetails(input: {
  requestedAt?: string;
  completedAt: string;
  intro: string;
  daemonStatus: string;
  webUiStatus: string;
  activeRevision?: string;
  serviceUrl?: string;
  serviceInspectionError?: string;
}): string[] {
  return [
    input.intro,
    '',
    `- Requested: ${input.requestedAt ?? 'unknown'}`,
    `- Completed: ${input.completedAt}`,
    `- Web UI: ${input.webUiStatus}`,
    `- Daemon: ${input.daemonStatus}`,
    input.activeRevision ? `- Active release: ${input.activeRevision}` : undefined,
    input.serviceUrl ? `- URL: ${input.serviceUrl}` : undefined,
    input.serviceInspectionError ? `- Service inspection: failed (${input.serviceInspectionError})` : undefined,
  ].filter((line): line is string => typeof line === 'string');
}

function buildApplicationFailureDetails(input: {
  requestedAt?: string;
  failedAt: string;
  intro: string;
  phase?: string;
  error: string;
  activeRevision?: string;
  serviceUrl?: string;
  serviceInspectionError?: string;
}): string[] {
  return [
    input.intro,
    '',
    `- Requested: ${input.requestedAt ?? 'unknown'}`,
    `- Failed: ${input.failedAt}`,
    input.phase ? `- Phase: ${input.phase}` : undefined,
    `- Error: ${input.error}`,
    input.activeRevision ? `- Active release: ${input.activeRevision}` : undefined,
    input.serviceUrl ? `- URL: ${input.serviceUrl}` : undefined,
    input.serviceInspectionError ? `- Service inspection: failed (${input.serviceInspectionError})` : undefined,
  ].filter((line): line is string => typeof line === 'string');
}

export function writeRestartCompletionInboxEntry(input: RestartCompletionInboxEntryInput): string {
  const repoRoot = resolveEffectiveRepoRoot(input.repoRoot);
  const stateRoot = resolveEffectiveActivityStateRoot(input.stateRoot);
  const completedAt = new Date().toISOString();
  const serviceContext = readWebUiContext(repoRoot);

  return writeDeploymentInboxEntry({
    repoRoot,
    stateRoot,
    profile: input.profile,
    createdAt: completedAt,
    idPrefix: 'application-restart',
    summary: buildApplicationSummary('Application restart complete', serviceContext.activeRevision),
    details: buildApplicationCompletionDetails({
      requestedAt: input.requestedAt,
      completedAt,
      intro: 'Managed web UI restart is complete.',
      daemonStatus: input.daemonStatus,
      webUiStatus: input.webUiStatus,
      activeRevision: serviceContext.activeRevision,
      serviceUrl: serviceContext.serviceUrl,
      serviceInspectionError: serviceContext.serviceInspectionError,
    }),
  });
}

export function writeRestartFailureInboxEntry(input: RestartFailureInboxEntryInput): string {
  const repoRoot = resolveEffectiveRepoRoot(input.repoRoot);
  const stateRoot = resolveEffectiveActivityStateRoot(input.stateRoot);
  const failedAt = new Date().toISOString();
  const serviceContext = readWebUiContext(repoRoot);

  return writeDeploymentInboxEntry({
    repoRoot,
    stateRoot,
    profile: input.profile,
    createdAt: failedAt,
    idPrefix: 'application-restart-failed',
    summary: 'Application restart failed',
    details: buildApplicationFailureDetails({
      requestedAt: input.requestedAt,
      failedAt,
      intro: 'Managed application restart did not complete.',
      phase: input.phase,
      error: input.error,
      activeRevision: serviceContext.activeRevision,
      serviceUrl: serviceContext.serviceUrl,
      serviceInspectionError: serviceContext.serviceInspectionError,
    }),
  });
}

export function writeUpdateCompletionInboxEntry(input: UpdateCompletionInboxEntryInput): string {
  const repoRoot = resolveEffectiveRepoRoot(input.repoRoot);
  const stateRoot = resolveEffectiveActivityStateRoot(input.stateRoot);
  const completedAt = new Date().toISOString();
  const serviceContext = readWebUiContext(repoRoot);

  return writeDeploymentInboxEntry({
    repoRoot,
    stateRoot,
    profile: input.profile,
    createdAt: completedAt,
    idPrefix: 'application-update',
    summary: buildApplicationSummary('Application update complete', serviceContext.activeRevision),
    details: buildApplicationCompletionDetails({
      requestedAt: input.requestedAt,
      completedAt,
      intro: 'Managed application update is complete.',
      daemonStatus: input.daemonStatus,
      webUiStatus: input.webUiStatus,
      activeRevision: serviceContext.activeRevision,
      serviceUrl: serviceContext.serviceUrl,
      serviceInspectionError: serviceContext.serviceInspectionError,
    }),
  });
}

export function writeUpdateFailureInboxEntry(input: UpdateFailureInboxEntryInput): string {
  const repoRoot = resolveEffectiveRepoRoot(input.repoRoot);
  const stateRoot = resolveEffectiveActivityStateRoot(input.stateRoot);
  const failedAt = new Date().toISOString();
  const serviceContext = readWebUiContext(repoRoot);

  return writeDeploymentInboxEntry({
    repoRoot,
    stateRoot,
    profile: input.profile,
    createdAt: failedAt,
    idPrefix: 'application-update-failed',
    summary: 'Application update failed',
    details: buildApplicationFailureDetails({
      requestedAt: input.requestedAt,
      failedAt,
      intro: 'Managed application update did not complete.',
      phase: input.phase,
      error: input.error,
      activeRevision: serviceContext.activeRevision,
      serviceUrl: serviceContext.serviceUrl,
      serviceInspectionError: serviceContext.serviceInspectionError,
    }),
  });
}
