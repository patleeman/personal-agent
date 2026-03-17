import {
  createProjectActivityEntry,
  writeProfileActivityEntry,
} from '@personal-agent/core';
import { getWebUiServiceStatus } from '@personal-agent/gateway';
import { getRepoRoot } from '@personal-agent/resources';

export interface RestartCompletionInboxEntryInput {
  profile: string;
  repoRoot?: string;
  requestedAt?: string;
  daemonStatus: string;
  webUiStatus: string;
  restartedGatewayServices: string[];
  skippedGatewayServices: string[];
}

export interface RestartFailureInboxEntryInput {
  profile: string;
  repoRoot?: string;
  requestedAt?: string;
  phase?: string;
  error: string;
}

export interface UpdateCompletionInboxEntryInput {
  profile: string;
  repoRoot?: string;
  requestedAt?: string;
  daemonStatus: string;
  webUiStatus: string;
  restartedGatewayServices: string[];
  skippedGatewayServices: string[];
}

export interface UpdateFailureInboxEntryInput {
  profile: string;
  repoRoot?: string;
  requestedAt?: string;
  phase?: string;
  error: string;
}

export interface WebUiRollbackInboxEntryInput {
  profile: string;
  repoRoot?: string;
  rolledBackFromSlot: 'blue' | 'green';
  rolledBackFromRevision?: string;
  restoredSlot: 'blue' | 'green';
  restoredRevision?: string;
  reason?: string;
  markedBadRevision?: string;
  markedBadReason?: string;
}

export interface WebUiMarkedBadInboxEntryInput {
  profile: string;
  repoRoot?: string;
  slot?: 'blue' | 'green';
  revision: string;
  reason?: string;
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

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

function resolveEffectiveRepoRoot(repoRoot?: string): string {
  return getRepoRoot(repoRoot);
}

function readWebUiContext(repoRoot: string): {
  activeSlot?: 'blue' | 'green';
  activeRevision?: string;
  serviceUrl?: string;
  serviceInspectionError?: string;
} {
  try {
    const serviceStatus = getWebUiServiceStatus({ repoRoot });
    return {
      activeSlot: serviceStatus.deployment?.activeSlot,
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
  profile: string;
  createdAt: string;
  idPrefix: string;
  summary: string;
  details: string[];
}): string {
  return writeProfileActivityEntry({
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

function buildApplicationSummary(prefix: string, activeSlot?: 'blue' | 'green', revision?: string): string {
  const parts = [prefix];

  if (activeSlot) {
    parts.push(`${activeSlot} live`);
  }

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
  restartedGatewayServices: string[];
  skippedGatewayServices: string[];
  activeSlot?: 'blue' | 'green';
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
    `- Gateway services restarted: ${formatList(input.restartedGatewayServices)}`,
    `- Gateway services skipped: ${formatList(input.skippedGatewayServices)}`,
    input.activeSlot ? `- Active slot: ${input.activeSlot}` : undefined,
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
  activeSlot?: 'blue' | 'green';
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
    input.activeSlot ? `- Last active slot: ${input.activeSlot}` : undefined,
    input.activeRevision ? `- Last active release: ${input.activeRevision}` : undefined,
    input.serviceUrl ? `- URL: ${input.serviceUrl}` : undefined,
    input.serviceInspectionError ? `- Service inspection: failed (${input.serviceInspectionError})` : undefined,
  ].filter((line): line is string => typeof line === 'string');
}

export function writeRestartCompletionInboxEntry(input: RestartCompletionInboxEntryInput): string {
  const repoRoot = resolveEffectiveRepoRoot(input.repoRoot);
  const completedAt = new Date().toISOString();
  const serviceContext = readWebUiContext(repoRoot);

  return writeDeploymentInboxEntry({
    repoRoot,
    profile: input.profile,
    createdAt: completedAt,
    idPrefix: 'application-restart',
    summary: buildApplicationSummary('Application restart complete', serviceContext.activeSlot, serviceContext.activeRevision),
    details: buildApplicationCompletionDetails({
      requestedAt: input.requestedAt,
      completedAt,
      intro: 'Managed web UI blue/green cutover is complete.',
      daemonStatus: input.daemonStatus,
      webUiStatus: input.webUiStatus,
      restartedGatewayServices: input.restartedGatewayServices,
      skippedGatewayServices: input.skippedGatewayServices,
      activeSlot: serviceContext.activeSlot,
      activeRevision: serviceContext.activeRevision,
      serviceUrl: serviceContext.serviceUrl,
      serviceInspectionError: serviceContext.serviceInspectionError,
    }),
  });
}

export function writeRestartFailureInboxEntry(input: RestartFailureInboxEntryInput): string {
  const repoRoot = resolveEffectiveRepoRoot(input.repoRoot);
  const failedAt = new Date().toISOString();
  const serviceContext = readWebUiContext(repoRoot);

  return writeDeploymentInboxEntry({
    repoRoot,
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
      activeSlot: serviceContext.activeSlot,
      activeRevision: serviceContext.activeRevision,
      serviceUrl: serviceContext.serviceUrl,
      serviceInspectionError: serviceContext.serviceInspectionError,
    }),
  });
}

export function writeUpdateCompletionInboxEntry(input: UpdateCompletionInboxEntryInput): string {
  const repoRoot = resolveEffectiveRepoRoot(input.repoRoot);
  const completedAt = new Date().toISOString();
  const serviceContext = readWebUiContext(repoRoot);

  return writeDeploymentInboxEntry({
    repoRoot,
    profile: input.profile,
    createdAt: completedAt,
    idPrefix: 'application-update',
    summary: buildApplicationSummary('Application update complete', serviceContext.activeSlot, serviceContext.activeRevision),
    details: buildApplicationCompletionDetails({
      requestedAt: input.requestedAt,
      completedAt,
      intro: 'Managed application update and web UI blue/green cutover are complete.',
      daemonStatus: input.daemonStatus,
      webUiStatus: input.webUiStatus,
      restartedGatewayServices: input.restartedGatewayServices,
      skippedGatewayServices: input.skippedGatewayServices,
      activeSlot: serviceContext.activeSlot,
      activeRevision: serviceContext.activeRevision,
      serviceUrl: serviceContext.serviceUrl,
      serviceInspectionError: serviceContext.serviceInspectionError,
    }),
  });
}

export function writeUpdateFailureInboxEntry(input: UpdateFailureInboxEntryInput): string {
  const repoRoot = resolveEffectiveRepoRoot(input.repoRoot);
  const failedAt = new Date().toISOString();
  const serviceContext = readWebUiContext(repoRoot);

  return writeDeploymentInboxEntry({
    repoRoot,
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
      activeSlot: serviceContext.activeSlot,
      activeRevision: serviceContext.activeRevision,
      serviceUrl: serviceContext.serviceUrl,
      serviceInspectionError: serviceContext.serviceInspectionError,
    }),
  });
}

export function writeWebUiRollbackInboxEntry(input: WebUiRollbackInboxEntryInput): string {
  const repoRoot = resolveEffectiveRepoRoot(input.repoRoot);
  const completedAt = new Date().toISOString();
  const serviceContext = readWebUiContext(repoRoot);

  const details = [
    'Managed web UI rollback completed.',
    '',
    `- Completed: ${completedAt}`,
    `- Rolled back from: ${input.rolledBackFromSlot}${input.rolledBackFromRevision ? ` · ${input.rolledBackFromRevision}` : ''}`,
    `- Restored release: ${input.restoredSlot}${input.restoredRevision ? ` · ${input.restoredRevision}` : ''}`,
    input.reason ? `- Reason: ${input.reason}` : undefined,
    input.markedBadRevision ? `- Marked bad: ${input.markedBadRevision}${input.markedBadReason ? ` · ${input.markedBadReason}` : ''}` : undefined,
    serviceContext.serviceUrl ? `- URL: ${serviceContext.serviceUrl}` : undefined,
    serviceContext.activeSlot ? `- Active slot: ${serviceContext.activeSlot}` : undefined,
    serviceContext.activeRevision ? `- Active release: ${serviceContext.activeRevision}` : undefined,
    serviceContext.serviceInspectionError ? `- Service inspection: failed (${serviceContext.serviceInspectionError})` : undefined,
  ].filter((line): line is string => typeof line === 'string');

  const summaryParts = ['Web UI rollback complete', `${input.restoredSlot} live`];
  if (input.restoredRevision) {
    summaryParts.push(input.restoredRevision);
  }

  return writeDeploymentInboxEntry({
    repoRoot,
    profile: input.profile,
    createdAt: completedAt,
    idPrefix: 'web-ui-rollback',
    summary: summaryParts.join(' · '),
    details,
  });
}

export function writeWebUiMarkedBadInboxEntry(input: WebUiMarkedBadInboxEntryInput): string {
  const repoRoot = resolveEffectiveRepoRoot(input.repoRoot);
  const completedAt = new Date().toISOString();
  const serviceContext = readWebUiContext(repoRoot);

  const details = [
    'The active managed web UI release was marked bad.',
    '',
    `- Completed: ${completedAt}`,
    input.slot ? `- Slot: ${input.slot}` : undefined,
    `- Revision: ${input.revision}`,
    input.reason ? `- Reason: ${input.reason}` : undefined,
    serviceContext.serviceUrl ? `- URL: ${serviceContext.serviceUrl}` : undefined,
    serviceContext.activeSlot ? `- Active slot: ${serviceContext.activeSlot}` : undefined,
    serviceContext.activeRevision ? `- Active release: ${serviceContext.activeRevision}` : undefined,
    serviceContext.serviceInspectionError ? `- Service inspection: failed (${serviceContext.serviceInspectionError})` : undefined,
  ].filter((line): line is string => typeof line === 'string');

  const summaryParts = ['Web UI release marked bad', input.revision];
  if (input.slot) {
    summaryParts.push(input.slot);
  }

  return writeDeploymentInboxEntry({
    repoRoot,
    profile: input.profile,
    createdAt: completedAt,
    idPrefix: 'web-ui-mark-bad',
    summary: summaryParts.join(' · '),
    details,
  });
}
