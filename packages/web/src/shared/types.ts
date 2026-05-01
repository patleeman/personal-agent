interface MessageImage {
  alt: string;
  src?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  caption?: string;
  deferred?: boolean;
}

export interface PromptImageInput {
  name?: string;
  mimeType: string;
  data: string;
  previewUrl?: string;
}

export interface PromptAttachmentRefInput {
  attachmentId: string;
  revision?: number;
}

type ConversationArtifactKind = 'html' | 'mermaid' | 'latex';

export interface ConversationArtifactSummary {
  id: string;
  conversationId: string;
  title: string;
  kind: ConversationArtifactKind;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ConversationArtifactRecord extends ConversationArtifactSummary {
  content: string;
}

export interface ConversationArtifactToolDetails {
  action: 'save' | 'get' | 'list' | 'delete';
  conversationId: string;
  artifactId?: string;
  title?: string;
  kind?: ConversationArtifactKind;
  revision?: number;
  updatedAt?: string;
  openRequested?: boolean;
  artifactCount?: number;
  artifactIds?: string[];
  deleted?: boolean;
}

export interface ConversationCommitCheckpointFile {
  path: string;
  previousPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'unmerged' | 'unknown';
  additions: number;
  deletions: number;
  patch: string;
}

export interface ConversationCommitCheckpointComment {
  id: string;
  authorName: string;
  authorProfile?: string;
  body: string;
  filePath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationCommitCheckpointSummary {
  id: string;
  conversationId: string;
  title: string;
  cwd: string;
  commitSha: string;
  shortSha: string;
  subject: string;
  body?: string;
  authorName: string;
  authorEmail?: string;
  committedAt: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
  linesAdded: number;
  linesDeleted: number;
  commentCount: number;
}

export interface ConversationCommitCheckpointRecord extends ConversationCommitCheckpointSummary {
  files: ConversationCommitCheckpointFile[];
  comments: ConversationCommitCheckpointComment[];
  sourceKind?: 'checkpoint' | 'git';
  commentable?: boolean;
}

export interface ConversationCheckpointToolDetails {
  action: 'save' | 'get' | 'list';
  conversationId: string;
  checkpointId?: string;
  commitSha?: string;
  shortSha?: string;
  title?: string;
  subject?: string;
  fileCount?: number;
  linesAdded?: number;
  linesDeleted?: number;
  cwd?: string;
  updatedAt?: string;
  openRequested?: boolean;
  checkpointCount?: number;
  checkpointIds?: string[];
  paths?: string[];
}

interface ConversationCheckpointGithubInfo {
  provider: 'github';
  repoUrl: string;
  commitUrl: string;
  pullRequestUrl?: string;
  pullRequestTitle?: string;
  pullRequestNumber?: number;
}

export interface ConversationCheckpointReviewContext {
  conversationId: string;
  checkpointId: string;
  github: ConversationCheckpointGithubInfo | null;
}

type ConversationAttachmentKind = 'excalidraw';

interface ConversationAttachmentRevision {
  revision: number;
  createdAt: string;
  sourceName: string;
  sourceMimeType: string;
  sourceDownloadPath: string;
  previewName: string;
  previewMimeType: string;
  previewDownloadPath: string;
  note?: string;
}

export interface ConversationAttachmentSummary {
  id: string;
  conversationId: string;
  kind: ConversationAttachmentKind;
  title: string;
  createdAt: string;
  updatedAt: string;
  currentRevision: number;
  latestRevision: ConversationAttachmentRevision;
}

export interface ConversationAttachmentRecord extends ConversationAttachmentSummary {
  revisions: ConversationAttachmentRevision[];
}

export interface ConversationAttachmentAssetData {
  dataUrl: string;
  mimeType: string;
  fileName: string;
}

export type MessageBlock =
  | { type: 'user';      id?: string; ts: string; text: string; images?: MessageImage[] }
  | { type: 'text';      id?: string; ts: string; text: string; streaming?: boolean }
  | { type: 'context';   id?: string; ts: string; text: string; customType?: string }
  | { type: 'summary';   id?: string; ts: string; kind: 'compaction' | 'branch' | 'related'; title: string; text: string; detail?: string }
  | { type: 'thinking';  id?: string; ts: string; text: string }
  | { type: 'tool_use';  id?: string; ts: string; tool: string; input: Record<string, unknown>; output: string; durationMs?: number; running?: boolean; status?: 'running' | 'ok' | 'error'; error?: boolean; _toolCallId?: string; details?: unknown; outputDeferred?: boolean }
  | { type: 'subagent';  id?: string; ts: string; name: string; prompt: string; status: 'running' | 'complete' | 'failed'; summary?: string }
  | { type: 'image';     id?: string; ts: string; alt: string; src?: string; mimeType?: string; width?: number; height?: number; caption?: string; deferred?: boolean }
  | { type: 'error';     id?: string; ts: string; tool?: string; message: string };

interface ProjectMilestone {
  id: string;
  title: string;
  status: string;
  summary?: string;
}

interface ProjectPlan {
  currentMilestoneId?: string;
  milestones: ProjectMilestone[];
  tasks: ProjectTask[];
}

interface ProjectRequirements {
  goal: string;
  acceptanceCriteria: string[];
}

export interface ProjectRecord {
  id: string;
  profile?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  title: string;
  description: string;
  repoRoot?: string;
  summary: string;
  requirements: ProjectRequirements;
  status: string;
  blockers: string[];
  currentFocus?: string;
  recentProgress: string[];
  planSummary?: string;
  completionSummary?: string;
  plan: ProjectPlan;
}

interface ProjectTask {
  id: string;
  status: string;
  title: string;
  milestoneId?: string;
}

export interface ScheduledTaskSummary {
  id: string;
  title?: string;
  filePath?: string;
  scheduleType: string;
  targetType?: string;
  running: boolean;
  enabled: boolean;
  cron?: string;
  at?: string;
  prompt: string;
  model?: string;
  thinkingLevel?: string;
  cwd?: string;
  catchUpWindowSeconds?: number;
  threadConversationId?: string;
  threadTitle?: string;
  lastStatus?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastAttemptCount?: number;
}

type ScheduledTaskThreadMode = 'dedicated' | 'existing' | 'none';

export interface ScheduledTaskActivityEntry {
  id: string;
  kind: 'missed';
  createdAt: string;
  count: number;
  firstScheduledAt: string;
  lastScheduledAt: string;
  exampleScheduledAt: string[];
  outcome: 'skipped' | 'catch-up-started';
}

export interface ScheduledTaskDetail {
  id: string;
  title?: string;
  filePath?: string;
  running: boolean;
  enabled: boolean;
  scheduleType: string;
  targetType?: string;
  cron?: string;
  at?: string;
  model?: string;
  thinkingLevel?: string;
  cwd?: string;
  timeoutSeconds?: number;
  catchUpWindowSeconds?: number;
  prompt: string;
  lastStatus?: string;
  lastRunAt?: string;
  activity?: ScheduledTaskActivityEntry[];
  threadMode: ScheduledTaskThreadMode;
  threadConversationId?: string;
  threadTitle?: string;
}

interface DurableRunSource {
  type: string;
  id?: string;
  filePath?: string;
}

interface DurableRunManifest {
  version: number;
  id: string;
  kind: string;
  resumePolicy: string;
  createdAt: string;
  spec: Record<string, unknown>;
  source?: DurableRunSource;
}

interface DurableRunStatusRecord {
  version: number;
  runId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  activeAttempt: number;
  startedAt?: string;
  completedAt?: string;
  checkpointKey?: string;
  lastError?: string;
}

interface DurableRunCheckpoint {
  version: number;
  runId: string;
  updatedAt: string;
  step?: string;
  cursor?: string;
  payload?: Record<string, unknown>;
}

interface DurableRunPaths {
  root: string;
  manifestPath: string;
  statusPath: string;
  checkpointPath: string;
  eventsPath: string;
  outputLogPath: string;
  resultPath: string;
}

export interface DurableRunRecord {
  runId: string;
  paths: DurableRunPaths;
  manifest?: DurableRunManifest;
  status?: DurableRunStatusRecord;
  checkpoint?: DurableRunCheckpoint;
  result?: Record<string, unknown>;
  problems: string[];
  recoveryAction: string;
  location?: 'local' | 'remote';
  attentionDismissed?: boolean;
  attentionSignature?: string | null;
}

interface DurableRunsSummary {
  total: number;
  recoveryActions: Record<string, number>;
  statuses: Record<string, number>;
}

export interface DurableRunListResult {
  scannedAt: string;
  runsRoot: string;
  summary: DurableRunsSummary;
  runs: DurableRunRecord[];
}

export interface DurableRunDetailResult {
  scannedAt: string;
  runsRoot: string;
  run: DurableRunRecord;
}

interface LogTail {
  path?: string;
  lines: string[];
}

interface DaemonServiceSummary {
  platform: string;
  identifier: string;
  manifestPath: string;
  installed: boolean;
  running: boolean;
  logFile?: string;
  error?: string;
}

interface DaemonRuntimeSummary {
  running: boolean;
  socketPath: string;
  pid?: number;
  startedAt?: string;
  moduleCount: number;
  queueDepth?: number;
  maxQueueDepth?: number;
}

export interface DaemonState {
  warnings: string[];
  service: DaemonServiceSummary;
  runtime: DaemonRuntimeSummary;
  log: LogTail;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export interface ConversationContextDocRef {
  path: string;
  title: string;
  kind: 'doc' | 'file';
  mentionId?: string;
  summary?: string;
}

export interface SessionMeta {
  id: string;
  file: string;
  timestamp: string;
  cwd: string;
  workspaceCwd?: string | null;
  cwdSlug: string;
  model: string;
  title: string;
  messageCount: number;
  isRunning?: boolean;
  isLive?: boolean;
  lastActivityAt?: string;
  parentSessionFile?: string;
  parentSessionId?: string;
  sourceRunId?: string;
  remoteHostId?: string;
  remoteHostLabel?: string;
  remoteConversationId?: string;
  automationTaskId?: string;
  automationTitle?: string;
  needsAttention?: boolean;
  attentionUpdatedAt?: string;
  attentionUnreadMessageCount?: number;
  attentionUnreadActivityCount?: number;
  attentionActivityIds?: string[];
  deferredResumes?: DeferredResumeSummary[];
  attachedContextDocs?: ConversationContextDocRef[];
}

export type ConversationSummaryStatus = 'done' | 'blocked' | 'in_progress' | 'needs_user' | 'unknown';

export interface ConversationSummaryRecord {
  sessionId: string;
  fingerprint: string;
  title: string;
  cwd: string;
  displaySummary: string;
  outcome: string;
  status: ConversationSummaryStatus;
  promptSummary: string;
  searchText: string;
  keyTerms: string[];
  filesTouched: string[];
  updatedAt: string;
}

export type DisplayBlock =
  | { type: 'user';     id: string; ts: string; text: string; images?: MessageImage[] }
  | { type: 'text';     id: string; ts: string; text: string }
  | { type: 'context';  id: string; ts: string; text: string; customType?: string }
  | { type: 'summary';  id: string; ts: string; kind: 'compaction' | 'branch' | 'related'; title: string; text: string; detail?: string }
  | { type: 'thinking'; id: string; ts: string; text: string }
  | { type: 'tool_use'; id: string; ts: string; tool: string; input: Record<string, unknown>; output: string; durationMs?: number; toolCallId: string; details?: unknown; outputDeferred?: boolean }
  | { type: 'image';    id: string; ts: string; alt: string; src?: string; mimeType?: string; width?: number; height?: number; caption?: string; deferred?: boolean }
  | { type: 'error';    id: string; ts: string; tool?: string; message: string };

type ContextUsageSegmentKey = 'system' | 'user' | 'assistant' | 'tool' | 'summary' | 'other';

export interface ContextUsageSegment {
  key: ContextUsageSegmentKey;
  label: string;
  tokens: number;
}

export interface SessionContextUsage {
  tokens: number | null;
  modelId?: string;
  contextWindow?: number;
  percent?: number | null;
  segments?: ContextUsageSegment[];
}

export interface SessionDetail {
  meta: SessionMeta;
  blocks: DisplayBlock[];
  blockOffset: number;
  totalBlocks: number;
  contextUsage: SessionContextUsage | null;
  signature?: string;
}

interface SessionDetailUnchangedResponse {
  unchanged: true;
  sessionId: string;
  signature: string | null;
}

export interface SessionDetailAppendOnlyResponse {
  appendOnly: true;
  meta: SessionMeta;
  blocks: DisplayBlock[];
  blockOffset: number;
  totalBlocks: number;
  contextUsage: SessionContextUsage | null;
  signature: string | null;
}

export type SessionDetailResult = SessionDetail | SessionDetailUnchangedResponse | SessionDetailAppendOnlyResponse;

export interface ConversationContentSearchMatch {
  conversationId: string;
  title: string;
  cwd: string;
  lastActivityAt: string;
  isLive: boolean;
  isRunning: boolean;
  blockId: string;
  blockType: string;
  blockIndex: number;
  snippet: string;
}

export interface ConversationContentSearchResult {
  query: string;
  mode: 'phrase' | 'allTerms' | 'anyTerm';
  scope: 'all' | 'live' | 'running' | 'archived';
  totalMatching: number;
  returnedCount: number;
  matches: ConversationContentSearchMatch[];
}

export type AppEventTopic =
  | 'sessions'
  | 'sessionFiles'
  | 'artifacts'
  | 'checkpoints'
  | 'attachments'
  | 'tasks'
  | 'runs'
  | 'daemon'
  | 'workspace'
  | 'knowledgeBase';

export type AppEvent =
  | { type: 'connected' }
  | { type: 'invalidate'; topics: AppEventTopic[] }
  | { type: 'live_title'; sessionId: string; title: string }
  | { type: 'session_meta_changed'; sessionId: string }
  | { type: 'session_file_changed'; sessionId: string }
  | { type: 'sessions_snapshot'; sessions: SessionMeta[] }
  | { type: 'tasks_snapshot'; tasks: ScheduledTaskSummary[] }
  | { type: 'runs_snapshot'; result: DurableRunListResult }
  | { type: 'daemon_snapshot'; state: DaemonState };

export type DesktopAppEvent =
  | { type: 'invalidate'; topics: AppEventTopic[] }
  | { type: 'live_title'; sessionId: string; title: string }
  | { type: 'session_meta_changed'; sessionId: string }
  | { type: 'session_file_changed'; sessionId: string }
  | { type: 'sessions'; sessions: SessionMeta[] }
  | { type: 'tasks'; tasks: ScheduledTaskSummary[] }
  | { type: 'runs'; result: DurableRunListResult }
  | { type: 'daemon'; state: DaemonState };

// ── Live session ──────────────────────────────────────────────────────────────

interface GitWorkingTreeChange {
  relativePath: string;
  change: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'untracked' | 'conflicted';
}

interface GitWorkingTreeSummary {
  changeCount: number;
  linesAdded: number;
  linesDeleted: number;
  changes: GitWorkingTreeChange[];
}

export interface LiveSessionContext {
  cwd: string;
  branch: string | null;
  git: GitWorkingTreeSummary | null;
}

type ConversationBootstrapLiveState = { live: false } | ({ live: true } & LiveSessionMeta);

export interface ConversationBootstrapState {
  conversationId: string;
  sessionDetail: SessionDetail | null;
  sessionDetailSignature?: string | null;
  sessionDetailUnchanged?: boolean;
  sessionDetailAppendOnly?: SessionDetailAppendOnlyResponse | null;
  liveSession: ConversationBootstrapLiveState;
}

export interface DeferredResumeSummary {
  id: string;
  sessionFile: string;
  prompt: string;
  dueAt: string;
  createdAt: string;
  attempts: number;
  status: 'scheduled' | 'ready';
  readyAt?: string;
  kind?: 'continue' | 'reminder' | 'task-callback';
  title?: string;
  behavior?: 'steer' | 'followUp';
  delivery?: {
    alertLevel: 'none' | 'passive' | 'disruptive';
    autoResumeIfOpen: boolean;
    requireAck: boolean;
  };
}

export interface ConversationAutoModeState {
  enabled: boolean;
  stopReason: string | null;
  updatedAt: string | null;
}

export interface ConversationCwdChangeResult {
  id: string;
  sessionFile: string;
  cwd: string;
  changed: boolean;
}

export interface ConversationRecoveryResult {
  conversationId: string;
  live: boolean;
  recovered: boolean;
  replayedPendingOperation: boolean;
  usedFallbackPrompt: boolean;
}

export interface FolderPickerResult {
  path: string | null;
  cancelled: boolean;
}

export interface FilePickerResult {
  paths: string[];
  cancelled: boolean;
}

export interface LiveSessionMeta {
  id:                   string;
  cwd:                  string;
  sessionFile:          string;
  title?:               string;
  isStreaming:          boolean;
  hasPendingHiddenTurn?: boolean;
}

export interface LiveSessionCreateResult {
  id: string;
  sessionFile: string;
  bootstrap?: ConversationBootstrapState;
}

export interface LiveSessionForkEntry {
  entryId: string;
  text: string;
}

export interface LiveSessionExportResult {
  ok: boolean;
  path: string;
}

export type DesktopHostRecord =
  | {
      id: string;
      label: string;
      kind: 'local';
    }
  | {
      id: string;
      label: string;
      kind: 'ssh';
      sshTarget: string;
    };

export interface DesktopEnvironmentState {
  isElectron: true;
  activeHostId: string;
  activeHostLabel: string;
  activeHostKind: DesktopHostRecord['kind'];
  activeHostSummary: string;
  launchMode?: 'stable' | 'testing';
  launchLabel?: string;
}

export interface DesktopConnectionsState {
  hosts: Array<Extract<DesktopHostRecord, { kind: 'ssh' }>>;
}

export interface DesktopRemoteDirectoryEntry {
  name: string;
  path: string;
  isDir: boolean;
  isHidden: boolean;
}

export interface DesktopRemoteDirectoryListing {
  path: string;
  parent?: string;
  entries: DesktopRemoteDirectoryEntry[];
}

export interface DesktopSshConnectionTestResult {
  ok: true;
  sshTarget: string;
  os: string;
  arch: string;
  platformKey: string;
  homeDirectory: string;
  tempDirectory: string;
  cacheDirectory: string;
  message: string;
}

export interface DesktopRemoteOperationStatus {
  hostId: string;
  hostLabel: string;
  conversationId?: string;
  scope: 'runtime' | 'directory';
  stage: 'connect' | 'detect-platform' | 'download-pi' | 'copy-pi' | 'copy-helper' | 'launch' | 'attach' | 'reconnect' | 'restart' | 'browse' | 'ready' | 'error';
  status: 'running' | 'success' | 'error';
  message: string;
  at: string;
}

export interface DesktopRemoteOperationBridgeEvent {
  type: 'open' | 'event' | 'close';
  event?: DesktopRemoteOperationStatus;
}

type DesktopUpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error';

interface DesktopAppUpdateState {
  supported: boolean;
  currentVersion: string;
  status: DesktopUpdateStatus;
  availableVersion?: string;
  downloadedVersion?: string;
  lastCheckedAt?: string;
  lastError?: string;
}

export interface DesktopAppPreferencesState {
  available: boolean;
  supportsStartOnSystemStart: boolean;
  autoInstallUpdates: boolean;
  startOnSystemStart: boolean;
  keyboardShortcuts: {
    conversationMode: string;
    workbenchMode: string;
    zenMode: string;
    toggleSidebar: string;
    toggleRightRail: string;
  };
  update: DesktopAppUpdateState;
}

export interface DesktopNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

export type LiveSessionSurfaceType = 'desktop_web' | 'mobile_web';

interface LiveSessionPresence {
  surfaceId: string;
  surfaceType: LiveSessionSurfaceType;
  connectedAt: string;
}

export interface LiveSessionPresenceState {
  surfaces: LiveSessionPresence[];
  controllerSurfaceId: string | null;
  controllerSurfaceType: LiveSessionSurfaceType | null;
  controllerAcquiredAt: string | null;
}

export interface QueuedPromptPreview {
  id: string;
  text: string;
  imageCount: number;
  restorable?: boolean;
  pending?: boolean;
}

export interface ParallelPromptPreview {
  id: string;
  prompt: string;
  childConversationId: string;
  status: 'running' | 'ready' | 'failed' | 'importing';
  imageCount: number;
  attachmentRefs: string[];
  touchedFiles: string[];
  parentTouchedFiles: string[];
  overlapFiles: string[];
  sideEffects: string[];
  resultPreview?: string;
  error?: string;
}

interface DesktopConversationStreamState {
  blocks: MessageBlock[];
  blockOffset: number;
  totalBlocks: number;
  hasSnapshot: boolean;
  isStreaming: boolean;
  isCompacting: boolean;
  error: string | null;
  title: string | null;
  tokens: { input: number; output: number; total: number } | null;
  cost: number | null;
  contextUsage: SessionContextUsage | null;
  pendingQueue: { steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] };
  parallelJobs: ParallelPromptPreview[];
  presence: LiveSessionPresenceState;
  autoModeState: ConversationAutoModeState | null;
  cwdChange: { newConversationId: string; cwd: string; autoContinued: boolean } | null;
}

export interface DesktopConversationState {
  conversationId: string;
  sessionDetail: SessionDetail | null;
  liveSession: ConversationBootstrapLiveState;
  stream: DesktopConversationStreamState;
}

// ── SSE events from /api/live-sessions/:id/events ────────────────────────────

export type SseEvent =
  | { type: 'snapshot';        blocks: DisplayBlock[]; blockOffset: number; totalBlocks: number }
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_end' }
  | { type: 'cwd_changed';     newConversationId: string; cwd: string; autoContinued: boolean }
  | { type: 'user_message';    block: Extract<DisplayBlock, { type: 'user' }> }
  | { type: 'queue_state';     steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] }
  | { type: 'parallel_state';  jobs: ParallelPromptPreview[] }
  | { type: 'presence_state';  state: LiveSessionPresenceState }
  | { type: 'auto_mode_state'; state: ConversationAutoModeState }
  | { type: 'text_delta';      delta: string }
  | { type: 'thinking_delta';  delta: string }
  | { type: 'tool_start';      toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_update';     toolCallId: string; partialResult: unknown }
  | { type: 'tool_end';        toolCallId: string; toolName: string; isError: boolean; durationMs: number; output: string; details?: unknown }
  | { type: 'title_update';    title: string }
  | { type: 'context_usage';   usage: SessionContextUsage | null }
  | { type: 'stats_update';    tokens: { input: number; output: number; total: number }; cost: number }
  | { type: 'compaction_start'; mode: 'manual' | 'auto' }
  | { type: 'error';           message: string };

export type DurableRunSseEvent =
  | { type: 'snapshot'; detail: DurableRunDetailResult; log: { path: string; log: string } }
  | { type: 'detail'; detail: DurableRunDetailResult }
  | { type: 'log_delta'; path: string; delta: string }
  | { type: 'deleted'; runId: string }
  | { type: 'error'; message: string };

// ── Memory browser ────────────────────────────────────────────────────────────

interface MemoryAgentsItem {
  source: string;
  path: string;
  exists: boolean;
  content?: string;
}

export interface MemorySkillItem {
  source: string;
  name: string;
  description: string;
  path: string;
  recentSessionCount?: number;
  lastUsedAt?: string | null;
  usedInLastSession?: boolean;
}

export interface MemoryDocItem {
  id: string;
  title: string;
  summary: string;
  description?: string;
  path: string;
  type?: string;
  status?: string;
  area?: string;
  role?: string;
  parent?: string;
  related?: string[];
  updated?: string;
  searchText?: string;
  referenceCount?: number;
  recentSessionCount?: number;
  lastUsedAt?: string | null;
  usedInLastSession?: boolean;
}

export interface MemoryData {
  profile: string;
  agentsMd: MemoryAgentsItem[];
  skills: MemorySkillItem[];
  memoryDocs: MemoryDocItem[];
}

export interface VaultFileSummary {
  id: string;
  kind: 'file' | 'folder';
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface VaultFileListResult {
  root: string;
  files: VaultFileSummary[];
}

export interface AppStatus {
  profile: string;
  repoRoot: string;
  projectCount: number;
  appRevision?: string;
}

type ModelServiceTier = 'auto' | 'default' | 'flex' | 'priority' | 'scale';

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  context: number;
  supportedServiceTiers?: ModelServiceTier[];
}

export interface ModelState {
  currentModel: string;
  currentThinkingLevel: string;
  currentServiceTier: string;
  models: ModelInfo[];
}

export type ModelProviderApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';
type ModelProviderInputType = 'text' | 'image';

interface ModelProviderCostConfig {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelProviderModelConfig {
  id: string;
  name?: string;
  api?: ModelProviderApi;
  baseUrl?: string;
  reasoning: boolean;
  input: ModelProviderInputType[];
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  cost?: ModelProviderCostConfig;
  compat?: Record<string, unknown>;
}

export interface ModelProviderConfig {
  id: string;
  baseUrl?: string;
  api?: ModelProviderApi;
  apiKey?: string;
  authHeader: boolean;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  modelOverrides?: Record<string, unknown>;
  models: ModelProviderModelConfig[];
}

export interface ModelProviderState {
  profile: string;
  filePath: string;
  providers: ModelProviderConfig[];
}

export interface DefaultCwdState {
  currentCwd: string;
  effectiveCwd: string;
}

export interface KnowledgeBaseGitStatus {
  localChangeCount: number;
  aheadCount: number;
  behindCount: number;
}

export interface KnowledgeBaseState {
  repoUrl: string;
  branch: string;
  configured: boolean;
  effectiveRoot: string;
  managedRoot: string;
  usesManagedRoot: boolean;
  syncStatus: 'disabled' | 'idle' | 'syncing' | 'error';
  lastSyncAt?: string;
  lastError?: string;
  gitStatus?: KnowledgeBaseGitStatus | null;
  recoveredEntryCount: number;
  recoveryDir: string;
}

export interface SkillFoldersState {
  configFile: string;
  skillDirs: string[];
}

export interface InstructionFilesState {
  configFile: string;
  instructionFiles: string[];
}

type ProviderAuthType = 'none' | 'api_key' | 'oauth' | 'environment';

export interface ProviderAuthSummary {
  id: string;
  modelCount: number;
  authType: ProviderAuthType;
  hasStoredCredential: boolean;
  apiKeySupported: boolean;
  oauthSupported: boolean;
  oauthProviderName: string;
  oauthUsesCallbackServer: boolean;
}

export interface ProviderAuthState {
  authFile: string;
  providers: ProviderAuthSummary[];
}

type ProviderOAuthLoginStatus = 'running' | 'completed' | 'failed' | 'cancelled';

interface ProviderOAuthPromptState {
  message: string;
  placeholder: string;
  allowEmpty: boolean;
  manualCode: boolean;
}

export interface ProviderOAuthLoginState {
  id: string;
  provider: string;
  providerName: string;
  status: ProviderOAuthLoginStatus;
  authUrl: string;
  authInstructions: string;
  prompt: ProviderOAuthPromptState | null;
  progress: string[];
  error: string;
  createdAt: string;
  updatedAt: string;
}

export type ProviderOAuthLoginStreamEvent =
  | { type: 'snapshot'; data: ProviderOAuthLoginState };

export interface ConversationTitleSettingsState {
  enabled: boolean;
  currentModel: string;
  effectiveModel: string;
}

interface ToolParameterSchema {
  type?: string;
  description?: string;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  items?: ToolParameterSchema;
  anyOf?: ToolParameterSchema[];
  oneOf?: ToolParameterSchema[];
  const?: unknown;
  enum?: unknown[];
  [key: string]: unknown;
}

export interface AgentToolInfo {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  active: boolean;
}

interface CliBinaryState {
  available: boolean;
  command: string;
  path?: string;
  version?: string;
  error?: string;
}

interface DependentCliToolState {
  id: string;
  name: string;
  description: string;
  configuredBy?: string;
  usedBy: string[];
  binary: CliBinaryState;
}

interface McpSkillBundleState {
  skillName: string;
  skillPath: string;
  manifestPath: string;
  serverNames: string[];
  overriddenServerNames: string[];
}

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'remote';
  command?: string;
  args: string[];
  cwd?: string;
  url?: string;
  env?: Record<string, string>;
  source?: 'config' | 'skill';
  sourcePath?: string;
  skillName?: string;
  skillPath?: string;
  manifestPath?: string;
  hasOAuth?: boolean;
  callbackUrl?: string;
  authorizeResource?: string;
  raw: Record<string, unknown>;
}

interface McpState {
  configPath: string;
  configExists: boolean;
  searchedPaths: string[];
  servers: McpServerConfig[];
  bundledSkills: McpSkillBundleState[];
}

interface ConfiguredPackageSource {
  source: string;
  filtered: boolean;
}

interface PackageSourceTargetState {
  target: 'profile' | 'local';
  settingsPath: string;
  packages: ConfiguredPackageSource[];
}

interface ProfilePackageSourceTargetState extends PackageSourceTargetState {
  profileName: string;
  current: boolean;
}

interface PackageInstallState {
  currentProfile: string;
  profileTargets: ProfilePackageSourceTargetState[];
  localTarget: PackageSourceTargetState;
}

export interface InjectedPromptMessage {
  customType: string;
  content: string;
  display?: boolean;
  details?: unknown;
}

export interface ToolsState {
  profile: string;
  cwd: string;
  activeTools: string[];
  tools: AgentToolInfo[];
  newSessionSystemPrompt: string;
  newSessionInjectedMessages: InjectedPromptMessage[];
  newSessionToolDefinitions: AgentToolInfo[];
  dependentCliTools: DependentCliToolState[];
  mcp: McpState;
  packageInstall: PackageInstallState;
}


// ── Vault editor ──────────────────────────────────────────────────────────────

export interface VaultEntry {
  id: string;
  kind: 'file' | 'folder';
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface VaultTreeResult {
  root: string;
  entries: VaultEntry[];
}

export interface VaultFileContent {
  id: string;
  content: string;
  updatedAt: string;
}

export interface VaultBacklink {
  id: string;
  name: string;
  excerpt: string;
}

export interface VaultBacklinksResult {
  id: string;
  targetName?: string;
  backlinks: VaultBacklink[];
}

export interface VaultSearchResult {
  id: string;
  name: string;
  excerpt: string;
  matchCount: number;
}

export interface VaultSearchResponse {
  results: VaultSearchResult[];
}

export interface VaultImageUploadResult {
  id: string;
  url: string;
}

export interface VaultShareImportResult {
  note: VaultEntry;
  sourceKind: 'text' | 'url' | 'image';
  title: string;
  asset?: {
    id: string;
    url: string;
  };
}

// ── Workspace explorer ──────────────────────────────────────────────────────

export type WorkspaceGitStatusChange = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'untracked' | 'conflicted';
export type WorkspaceEntryKind = 'file' | 'directory' | 'symlink' | 'other';

export interface WorkspaceEntry {
  name: string;
  path: string;
  kind: WorkspaceEntryKind;
  size: number | null;
  modifiedAt: string | null;
  gitStatus: WorkspaceGitStatusChange | null;
  descendantGitStatusCount: number;
}

export interface WorkspaceRootSnapshot {
  cwd: string;
  root: string;
  rootName: string;
  rootKind: 'git' | 'cwd';
  activeCwdRelativePath: string | null;
  branch: string | null;
  changes: Array<{ relativePath: string; change: WorkspaceGitStatusChange }>;
}

export interface WorkspaceDirectoryListing extends WorkspaceRootSnapshot {
  path: string;
  entries: WorkspaceEntry[];
}

export interface WorkspaceFileContent extends WorkspaceRootSnapshot {
  path: string;
  name: string;
  exists: boolean;
  kind: WorkspaceEntryKind;
  size: number | null;
  modifiedAt: string | null;
  binary: boolean;
  tooLarge: boolean;
  truncated: boolean;
  content: string | null;
  gitStatus: WorkspaceGitStatusChange | null;
}

export interface WorkspaceDiffOverlay extends WorkspaceRootSnapshot {
  path: string;
  gitStatus: WorkspaceGitStatusChange | null;
  binary: boolean;
  tooLarge: boolean;
  addedLines: number[];
  deletedBlocks: Array<{ afterLine: number; lines: string[] }>;
}

// ── Transcription / dictation ───────────────────────────────────────────────

export type TranscriptionProviderId = 'local-whisper';

export interface TranscriptionSettings {
  provider: TranscriptionProviderId | null;
  model: string;
}

export interface TranscriptionSettingsState {
  settingsFile: string;
  settings: TranscriptionSettings;
  providers: Array<{
    id: TranscriptionProviderId;
    label: string;
    status: 'implemented' | 'planned';
    transports: Array<'stream' | 'file'>;
  }>;
}

export interface TranscriptionResult {
  text: string;
  provider: TranscriptionProviderId;
  model?: string;
  language?: string;
  durationMs?: number;
  segments?: Array<{
    startMs?: number;
    endMs?: number;
    text: string;
  }>;
}
