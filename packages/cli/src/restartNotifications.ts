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

function buildRestartSummary(activeSlot?: 'blue' | 'green', revision?: string): string {
  const parts = ['Application restart complete'];

  if (activeSlot) {
    parts.push(`${activeSlot} live`);
  }

  if (revision && revision.trim().length > 0) {
    parts.push(revision.trim());
  }

  return parts.join(' · ');
}

export function writeRestartCompletionInboxEntry(input: RestartCompletionInboxEntryInput): string {
  const repoRoot = resolveEffectiveRepoRoot(input.repoRoot);
  const completedAt = new Date().toISOString();
  const serviceContext = readWebUiContext(repoRoot);

  const details = [
    'Managed web UI blue/green cutover is complete.',
    '',
    `- Requested: ${input.requestedAt ?? 'unknown'}`,
    `- Completed: ${completedAt}`,
    `- Web UI: ${input.webUiStatus}`,
    `- Daemon: ${input.daemonStatus}`,
    `- Gateway services restarted: ${formatList(input.restartedGatewayServices)}`,
    `- Gateway services skipped: ${formatList(input.skippedGatewayServices)}`,
    serviceContext.activeSlot ? `- Active slot: ${serviceContext.activeSlot}` : undefined,
    serviceContext.activeRevision ? `- Active release: ${serviceContext.activeRevision}` : undefined,
    serviceContext.serviceUrl ? `- URL: ${serviceContext.serviceUrl}` : undefined,
    serviceContext.serviceInspectionError ? `- Service inspection: failed (${serviceContext.serviceInspectionError})` : undefined,
  ].filter((line): line is string => typeof line === 'string');

  return writeDeploymentInboxEntry({
    repoRoot,
    profile: input.profile,
    createdAt: completedAt,
    idPrefix: 'application-restart',
    summary: buildRestartSummary(serviceContext.activeSlot, serviceContext.activeRevision),
    details,
  });
}

export function writeRestartFailureInboxEntry(input: RestartFailureInboxEntryInput): string {
  const repoRoot = resolveEffectiveRepoRoot(input.repoRoot);
  const failedAt = new Date().toISOString();
  const serviceContext = readWebUiContext(repoRoot);

  const details = [
    'Managed application restart did not complete.',
    '',
    `- Requested: ${input.requestedAt ?? 'unknown'}`,
    `- Failed: ${failedAt}`,
    input.phase ? `- Phase: ${input.phase}` : undefined,
    `- Error: ${input.error}`,
    serviceContext.activeSlot ? `- Last active slot: ${serviceContext.activeSlot}` : undefined,
    serviceContext.activeRevision ? `- Last active release: ${serviceContext.activeRevision}` : undefined,
    serviceContext.serviceUrl ? `- URL: ${serviceContext.serviceUrl}` : undefined,
    serviceContext.serviceInspectionError ? `- Service inspection: failed (${serviceContext.serviceInspectionError})` : undefined,
  ].filter((line): line is string => typeof line === 'string');

  return writeDeploymentInboxEntry({
    repoRoot,
    profile: input.profile,
    createdAt: failedAt,
    idPrefix: 'application-restart-failed',
    summary: 'Application restart failed',
    details,
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
