import type { MemoryModuleConfig } from '../config.js';

export interface MemoryModuleState {
  dirty: boolean;
  needsEmbedding: boolean;
  lastScanAt?: string;
  lastCleanupAt?: string;
  lastSummaryAt?: string;
  lastQmdUpdateAt?: string;
  lastQmdReconcileAt?: string;
  lastQmdEmbedAt?: string;
  scannedSessions: number;
  summarizedSessions: number;
  skippedSessions: number;
  failedSessions: number;
  deletedSummaries: number;
  pendingHintedSessions: number;
  lastError?: string;
}

export interface ResolvedMemoryConfig {
  enabled: boolean;
  sessionSource: string;
  summaryDir: string;
  scanIntervalMinutes: number;
  inactiveAfterMinutes: number;
  retentionDays: number;
  collections: MemoryModuleConfig['collections'];
  qmd: {
    index: string;
    updateDebounceSeconds: number;
    embedDebounceSeconds: number;
    reconcileIntervalMinutes: number;
  };
  summarization: {
    provider: 'pi-sdk';
    maxTurns: number;
    maxCharsPerTurn: number;
    maxTranscriptChars: number;
  };
  agentDir: string;
  stateFile: string;
}

export interface SessionScanRecord {
  fingerprint: string;
  summaryPath: string;
  workspaceKey: string;
  sessionId: string;
  summarizedAt: string;
}

export interface SessionScanState {
  version: number;
  sessions: Record<string, SessionScanRecord>;
}

export interface ParsedSessionTranscript {
  sessionId: string;
  cwd: string;
  startedAt: string;
  endedAt: string;
  transcript: string;
}

export interface SessionSummaryRequest {
  sessionFile: string;
  sessionId: string;
  cwd: string;
  startedAt: string;
  endedAt: string;
  transcript: string;
}

export interface SessionScanResult {
  scanned: number;
  summarized: number;
  skipped: number;
  failed: number;
  removed: number;
}

export interface MemoryModuleDependencies {
  now?: () => Date;
  summarizeSession?: (request: SessionSummaryRequest) => Promise<string>;
}
