import { basename, dirname, join, resolve } from 'path';
import type { MemoryModuleConfig } from '../config.js';
import type { ResolvedMemoryConfig } from './memory-types.js';

const DEFAULT_SCAN_INTERVAL_MINUTES = 5;
const DEFAULT_INACTIVE_AFTER_MINUTES = 30;
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_MAX_TURNS = 250;
const DEFAULT_MAX_CHARS_PER_TURN = 600;
const DEFAULT_MAX_TRANSCRIPT_CHARS = 18_000;
const DEFAULT_QMD_RECONCILE_INTERVAL_MINUTES = 60;

function toStateFile(summaryDir: string): string {
  return join(dirname(summaryDir), 'session-state.json');
}

function inferAgentDir(sessionSource: string): string {
  const resolvedSource = resolve(sessionSource);
  if (basename(resolvedSource) === 'sessions') {
    return dirname(resolvedSource);
  }

  return dirname(resolvedSource);
}

export function resolveMemoryConfig(config: MemoryModuleConfig): ResolvedMemoryConfig {
  const scanIntervalMinutes = Math.max(1, Math.floor(config.scanIntervalMinutes ?? DEFAULT_SCAN_INTERVAL_MINUTES));
  const inactiveAfterMinutes = Math.max(1, Math.floor(config.inactiveAfterMinutes ?? DEFAULT_INACTIVE_AFTER_MINUTES));
  const retentionDays = Math.max(0, Math.floor(config.retentionDays ?? DEFAULT_RETENTION_DAYS));

  const maxTurns = Math.max(20, Math.floor(config.summarization?.maxTurns ?? DEFAULT_MAX_TURNS));
  const maxCharsPerTurn = Math.max(120, Math.floor(config.summarization?.maxCharsPerTurn ?? DEFAULT_MAX_CHARS_PER_TURN));
  const maxTranscriptChars = Math.max(
    2_000,
    Math.floor(config.summarization?.maxTranscriptChars ?? DEFAULT_MAX_TRANSCRIPT_CHARS),
  );

  const qmdReconcileIntervalMinutes = Math.max(
    1,
    Math.floor(config.qmd.reconcileIntervalMinutes ?? DEFAULT_QMD_RECONCILE_INTERVAL_MINUTES),
  );

  return {
    enabled: config.enabled,
    sessionSource: config.sessionSource,
    summaryDir: config.summaryDir,
    scanIntervalMinutes,
    inactiveAfterMinutes,
    retentionDays,
    collections: config.collections,
    qmd: {
      ...config.qmd,
      reconcileIntervalMinutes: qmdReconcileIntervalMinutes,
    },
    summarization: {
      provider: 'pi-sdk',
      maxTurns,
      maxCharsPerTurn,
      maxTranscriptChars,
    },
    agentDir: inferAgentDir(config.sessionSource),
    stateFile: toStateFile(config.summaryDir),
  };
}
