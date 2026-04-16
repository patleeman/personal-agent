export interface MessageImage {
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

export type ConversationArtifactKind = 'html' | 'mermaid' | 'latex';

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

export interface ConversationCheckpointGithubInfo {
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
  structuralDiff: {
    available: boolean;
    command?: string;
  };
}

export interface ConversationCheckpointStructuralDiffResult {
  conversationId: string;
  checkpointId: string;
  filePath: string;
  display: 'inline' | 'side-by-side';
  available: boolean;
  content?: string;
}

export type ConversationAttachmentKind = 'excalidraw';

export interface ConversationAttachmentRevision {
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

export interface ActivityEntry {
  id: string;
  createdAt: string;
  profile: string;
  kind: string;
  summary: string;
  details?: string;
  read?: boolean;
  relatedProjectIds?: string[];
  relatedConversationIds?: string[];
  notificationState?: string;
}

export interface ActivitySnapshot {
  entries: ActivityEntry[];
  unreadCount: number;
}

export interface AlertEntry {
  id: string;
  profile: string;
  kind: string;
  severity: 'passive' | 'disruptive';
  status: 'active' | 'acknowledged' | 'dismissed';
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  conversationId?: string;
  activityId?: string;
  wakeupId?: string;
  sourceKind: string;
  sourceId: string;
  requiresAck: boolean;
  acknowledgedAt?: string;
  dismissedAt?: string;
}

export interface AlertSnapshot {
  entries: AlertEntry[];
  activeCount: number;
}

export interface ProjectMilestone {
  id: string;
  title: string;
  status: string;
  summary?: string;
}

export interface ProjectPlan {
  currentMilestoneId?: string;
  milestones: ProjectMilestone[];
  tasks: ProjectTask[];
}

export interface ProjectRequirements {
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

export interface InvalidProjectRecord {
  projectId: string;
  profile?: string;
  path: string;
  error: string;
}

export interface ProjectDiagnostics {
  profile: string;
  invalidProjects: InvalidProjectRecord[];
}

export interface ProjectTask {
  id: string;
  status: string;
  title: string;
  milestoneId?: string;
}

export interface ProjectDocumentRecord {
  path: string;
  content: string;
  updatedAt: string;
}

export interface ProjectFile {
  id: string;
  kind?: 'attachment' | 'artifact';
  path: string;
  title: string;
  description?: string;
  originalName: string;
  mimeType?: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  downloadPath: string;
  sourceKind?: 'file' | 'attachment' | 'artifact';
}

export interface ProjectLinkedConversation {
  conversationId: string;
  title: string;
  file?: string;
  cwd?: string;
  lastActivityAt?: string;
  isRunning: boolean;
  needsAttention: boolean;
  snippet?: string;
}

export interface ProjectTimelineEntry {
  id: string;
  kind: 'project' | 'document' | 'task' | 'file' | 'conversation' | 'activity';
  createdAt: string;
  title: string;
  href?: string;
}

export interface ProjectDetail {
  profile: string;
  project: ProjectRecord;
  taskCount: number;
  fileCount: number;
  attachmentCount: number;
  artifactCount: number;
  tasks: ProjectTask[];
  document: ProjectDocumentRecord | null;
  files: ProjectFile[];
  attachments: ProjectFile[];
  artifacts: ProjectFile[];
  linkedConversations: ProjectLinkedConversation[];
  timeline: ProjectTimelineEntry[];
  links?: NodeLinks;
}

export interface ScheduledTaskSummary {
  id: string;
  title?: string;
  filePath?: string;
  scheduleType: string;
  running: boolean;
  enabled: boolean;
  cron?: string;
  at?: string;
  prompt: string;
  model?: string;
  thinkingLevel?: string;
  cwd?: string;
  threadConversationId?: string;
  threadTitle?: string;
  lastStatus?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastAttemptCount?: number;
}

export type ScheduledTaskThreadMode = 'dedicated' | 'existing' | 'none';

export interface ScheduledTaskDetail {
  id: string;
  title?: string;
  filePath?: string;
  running: boolean;
  enabled: boolean;
  scheduleType: string;
  cron?: string;
  at?: string;
  model?: string;
  thinkingLevel?: string;
  cwd?: string;
  timeoutSeconds?: number;
  prompt: string;
  lastStatus?: string;
  lastRunAt?: string;
  threadMode: ScheduledTaskThreadMode;
  threadConversationId?: string;
  threadTitle?: string;
}

export interface DurableRunSource {
  type: string;
  id?: string;
  filePath?: string;
}

export interface DurableRunManifest {
  version: number;
  id: string;
  kind: string;
  resumePolicy: string;
  createdAt: string;
  spec: Record<string, unknown>;
  source?: DurableRunSource;
}

export interface DurableRunStatusRecord {
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

export interface DurableRunCheckpoint {
  version: number;
  runId: string;
  updatedAt: string;
  step?: string;
  cursor?: string;
  payload?: Record<string, unknown>;
}

export interface DurableRunPaths {
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
  problems: string[];
  recoveryAction: string;
  location?: 'local' | 'remote';
  attentionDismissed?: boolean;
  attentionSignature?: string | null;
}

export interface DurableRunsSummary {
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

export interface LogTail {
  path?: string;
  lines: string[];
}

export interface DaemonServiceSummary {
  platform: string;
  identifier: string;
  manifestPath: string;
  installed: boolean;
  running: boolean;
  logFile?: string;
  error?: string;
}

export interface DaemonRuntimeSummary {
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

export interface WebUiReleaseSummary {
  distDir: string;
  serverDir: string;
  serverEntryFile: string;
  sourceRepoRoot: string;
  revision?: string;
}

export interface WebUiDeploymentSummary {
  stablePort: number;
  activeRelease?: WebUiReleaseSummary;
}

export interface WebUiServiceSummary {
  platform: string;
  identifier: string;
  manifestPath: string;
  installed: boolean;
  running: boolean;
  logFile?: string;
  error?: string;
  repoRoot: string;
  port: number;
  url: string;
  tailscaleServe: boolean;
  tailscaleUrl?: string;
  resumeFallbackPrompt: string;
  deployment?: WebUiDeploymentSummary;
}

export interface WebUiState {
  warnings: string[];
  service: WebUiServiceSummary;
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

export type DisplayBlock =
  | { type: 'user';     id: string; ts: string; text: string; images?: MessageImage[] }
  | { type: 'text';     id: string; ts: string; text: string }
  | { type: 'context';  id: string; ts: string; text: string; customType?: string }
  | { type: 'summary';  id: string; ts: string; kind: 'compaction' | 'branch' | 'related'; title: string; text: string; detail?: string }
  | { type: 'thinking'; id: string; ts: string; text: string }
  | { type: 'tool_use'; id: string; ts: string; tool: string; input: Record<string, unknown>; output: string; durationMs?: number; toolCallId: string; details?: unknown; outputDeferred?: boolean }
  | { type: 'image';    id: string; ts: string; alt: string; src?: string; mimeType?: string; width?: number; height?: number; caption?: string; deferred?: boolean }
  | { type: 'error';    id: string; ts: string; tool?: string; message: string };

export type ContextUsageSegmentKey = 'system' | 'user' | 'assistant' | 'tool' | 'summary' | 'other';

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

export interface SessionDetailUnchangedResponse {
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

export type AppEventTopic =
  | 'sessions'
  | 'sessionFiles'
  | 'artifacts'
  | 'checkpoints'
  | 'attachments'
  | 'tasks'
  | 'runs'
  | 'daemon'
  | 'webUi'
  | 'workspace';

export type AppEvent =
  | { type: 'connected' }
  | { type: 'invalidate'; topics: AppEventTopic[] }
  | { type: 'live_title'; sessionId: string; title: string }
  | { type: 'session_meta_changed'; sessionId: string }
  | { type: 'session_file_changed'; sessionId: string }
  | { type: 'sessions_snapshot'; sessions: SessionMeta[] }
  | { type: 'tasks_snapshot'; tasks: ScheduledTaskSummary[] }
  | { type: 'runs_snapshot'; result: DurableRunListResult }
  | { type: 'daemon_snapshot'; state: DaemonState }
  | { type: 'web_ui_snapshot'; state: WebUiState };

export type DesktopAppEvent =
  | { type: 'invalidate'; topics: AppEventTopic[] }
  | { type: 'live_title'; sessionId: string; title: string }
  | { type: 'session_meta_changed'; sessionId: string }
  | { type: 'session_file_changed'; sessionId: string }
  | { type: 'sessions'; sessions: SessionMeta[] }
  | { type: 'tasks'; tasks: ScheduledTaskSummary[] }
  | { type: 'runs'; result: DurableRunListResult }
  | { type: 'daemon'; state: DaemonState }
  | { type: 'webUi'; state: WebUiState };

// ── Live session ──────────────────────────────────────────────────────────────

export interface GitWorkingTreeChange {
  relativePath: string;
  change: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'untracked' | 'conflicted';
}

export interface GitWorkingTreeSummary {
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

export interface ConversationProjectLinks {
  conversationId: string;
  relatedProjectIds: string[];
}

export type ConversationBootstrapLiveState = { live: false } | ({ live: true } & LiveSessionMeta);

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

export interface RemoteAccessSessionSummary {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface RemoteAccessAdminState {
  pendingPairings: Array<{
    id: string;
    createdAt: string;
    expiresAt: string;
  }>;
  sessions: RemoteAccessSessionSummary[];
}

export interface RemoteAccessPairingCodeResult {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string;
}

export interface RemoteAccessSessionState {
  required: boolean;
  session: RemoteAccessSessionSummary | null;
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
      workspaceRoot?: string;
      remoteRepoRoot?: string;
      remotePort?: number;
      autoConnect?: boolean;
    }
  | {
      id: string;
      label: string;
      kind: 'web';
      websocketUrl: string;
      workspaceRoot?: string;
      autoConnect?: boolean;
    };

export interface DesktopEnvironmentState {
  isElectron: true;
  activeHostId: string;
  activeHostLabel: string;
  activeHostKind: DesktopHostRecord['kind'];
  activeHostSummary: string;
  launchMode?: 'stable' | 'testing';
  launchLabel?: string;
  canManageConnections: true;
}

export interface DesktopConnectionsState {
  activeHostId: string;
  defaultHostId: string;
  hosts: DesktopHostRecord[];
}

export type DesktopWorkspaceServerTailscalePublishStatus = 'disabled' | 'published' | 'missing' | 'mismatch' | 'unavailable';

export interface DesktopWorkspaceServerTailscalePublishState {
  status: DesktopWorkspaceServerTailscalePublishStatus;
  path: string;
  expectedProxyTarget: string;
  actualProxyTarget?: string;
  message?: string;
}

export interface DesktopWorkspaceServerState {
  enabled: boolean;
  port: number;
  useTailscaleServe: boolean;
  running: boolean;
  websocketPath: string;
  localWebsocketUrl: string;
  tailnetWebsocketUrl?: string;
  tailscalePublishState: DesktopWorkspaceServerTailscalePublishState;
  logFile: string;
  pid?: number;
  error?: string;
}

export type DesktopUpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'waiting-for-idle' | 'installing' | 'error';

export interface DesktopAppUpdateState {
  supported: boolean;
  currentVersion: string;
  status: DesktopUpdateStatus;
  availableVersion?: string;
  downloadedVersion?: string;
  waitingForIdleReason?: string;
  lastCheckedAt?: string;
  lastError?: string;
}

export interface DesktopAppPreferencesState {
  available: boolean;
  supportsStartOnSystemStart: boolean;
  autoInstallUpdates: boolean;
  startOnSystemStart: boolean;
  update: DesktopAppUpdateState;
}

export interface DesktopNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

export type LiveSessionSurfaceType = 'desktop_web' | 'mobile_web';

export interface LiveSessionPresence {
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

export interface DesktopConversationStreamState {
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

export interface MemoryAgentsItem {
  source: string;
  path: string;
  exists: boolean;
  content?: string;
}

export type NodeLinkKind = 'note' | 'project' | 'skill';

export interface NodeLinkSummary {
  kind: NodeLinkKind;
  id: string;
  title: string;
  summary?: string;
}

export interface NodeLinks {
  outgoing: NodeLinkSummary[];
  incoming: NodeLinkSummary[];
  unresolved: string[];
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
  webUiRevision?: string;
}

export interface ApplicationRestartRequestResult {
  accepted: true;
  message: string;
  requestedAt: string;
  logFile: string;
}

export type ModelServiceTier = 'auto' | 'default' | 'flex' | 'priority' | 'scale';

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
export type ModelProviderInputType = 'text' | 'image';

export interface ModelProviderCostConfig {
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

export interface VaultRootState {
  currentRoot: string;
  effectiveRoot: string;
  defaultRoot: string;
  source: 'env' | 'config' | 'knowledge-base' | 'default';
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

export type ProviderAuthType = 'none' | 'api_key' | 'oauth' | 'environment';

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

export type ProviderOAuthLoginStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ProviderOAuthPromptState {
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

export interface ToolParameterSchema {
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

export interface CliBinaryState {
  available: boolean;
  command: string;
  path?: string;
  version?: string;
  error?: string;
}

export interface DependentCliToolState {
  id: string;
  name: string;
  description: string;
  configuredBy?: string;
  usedBy: string[];
  binary: CliBinaryState;
}

export interface McpSkillBundleState {
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

export interface McpState {
  configPath: string;
  configExists: boolean;
  searchedPaths: string[];
  servers: McpServerConfig[];
  bundledSkills: McpSkillBundleState[];
}

export interface McpServerToolSummary {
  name: string;
  description?: string;
}

export interface McpServerDetail {
  server?: string;
  transport?: string;
  commandLine?: string;
  toolCount?: number;
  tools: McpServerToolSummary[];
  rawOutput: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface McpToolDetail {
  server?: string;
  tool?: string;
  description?: string;
  schema?: ToolParameterSchema;
  rawOutput: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ConfiguredPackageSource {
  source: string;
  filtered: boolean;
}

export interface PackageSourceTargetState {
  target: 'profile' | 'local';
  settingsPath: string;
  packages: ConfiguredPackageSource[];
}

export interface ProfilePackageSourceTargetState extends PackageSourceTargetState {
  profileName: string;
  current: boolean;
}

export interface PackageInstallState {
  currentProfile: string;
  profileTargets: ProfilePackageSourceTargetState[];
  localTarget: PackageSourceTargetState;
}

export interface PackageInstallResult {
  installed: boolean;
  alreadyPresent: boolean;
  source: string;
  target: 'profile' | 'local';
  settingsPath: string;
  packageInstall: PackageInstallState;
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
