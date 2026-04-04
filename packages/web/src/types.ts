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

export type MessageBlock =
  | { type: 'user';      id?: string; ts: string; text: string; images?: MessageImage[] }
  | { type: 'text';      id?: string; ts: string; text: string; streaming?: boolean }
  | { type: 'context';   id?: string; ts: string; text: string; customType?: string }
  | { type: 'summary';   id?: string; ts: string; kind: 'compaction' | 'branch'; title: string; text: string }
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
  filePath: string;
  scheduleType: string;
  running: boolean;
  enabled: boolean;
  cron?: string;
  at?: string;
  prompt: string;
  model?: string;
  lastStatus?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastAttemptCount?: number;
}

export interface ScheduledTaskDetail {
  id: string;
  running: boolean;
  enabled: boolean;
  scheduleType: string;
  cron?: string;
  at?: string;
  model?: string;
  cwd?: string;
  timeoutSeconds?: number;
  prompt: string;
  lastStatus?: string;
  lastRunAt?: string;
  fileContent: string;
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

export type RemoteRunImportStatus = 'not_ready' | 'ready' | 'imported' | 'failed';

export interface RemoteExecutionRunSummary {
  targetId: string;
  targetLabel: string;
  transport: 'ssh';
  conversationId: string;
  localCwd: string;
  remoteCwd: string;
  prompt: string;
  submittedAt: string;
  importStatus: RemoteRunImportStatus;
  importedAt?: string;
  importSummary?: string;
  importError?: string;
  transcriptAvailable: boolean;
  transcriptFileName?: string;
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
  remoteExecution?: RemoteExecutionRunSummary;
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

export interface SyncConfigSummary {
  enabled: boolean;
  repoDir: string;
  remote: string;
  branch: string;
  intervalSeconds: number;
  autoResolveWithAgent: boolean;
  conflictResolverTaskSlug: string;
  resolverCooldownMinutes: number;
  autoResolveErrorsWithAgent: boolean;
  errorResolverTaskSlug: string;
  errorResolverCooldownMinutes: number;
}

export interface SyncGitSummary {
  hasRepo: boolean;
  currentBranch?: string;
  dirtyEntries?: number;
  lastCommit?: string;
  remoteUrl?: string;
}

export interface SyncModuleRuntimeDetail {
  running: boolean;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastCommitAt?: string;
  lastConflictAt?: string;
  lastConflictFiles: string[];
  lastResolverStartedAt?: string;
  lastResolverResult?: string;
  lastErrorResolverStartedAt?: string;
  lastErrorResolverResult?: string;
  lastError?: string;
}

export interface SyncDaemonSummary {
  connected: boolean;
  moduleLoaded: boolean;
  moduleEnabled: boolean;
  moduleDetail?: SyncModuleRuntimeDetail;
}

export interface SyncState {
  warnings: string[];
  config: SyncConfigSummary;
  git: SyncGitSummary;
  daemon: SyncDaemonSummary;
  log: LogTail;
}

export interface WebUiReleaseSummary {
  slot: 'blue' | 'green';
  slotDir: string;
  distDir: string;
  serverDir: string;
  serverEntryFile: string;
  sourceRepoRoot: string;
  builtAt: string;
  revision?: string;
}

export interface WebUiBadReleaseSummary {
  sourceRepoRoot: string;
  revision: string;
  markedBadAt: string;
  slot?: 'blue' | 'green';
  reason?: string;
}

export interface WebUiDeploymentSummary {
  stablePort: number;
  activeSlot?: 'blue' | 'green';
  activeRelease?: WebUiReleaseSummary;
  inactiveRelease?: WebUiReleaseSummary;
  activeReleaseBad?: WebUiBadReleaseSummary;
  inactiveReleaseBad?: WebUiBadReleaseSummary;
  badReleases: WebUiBadReleaseSummary[];
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
  companionPort: number;
  companionUrl: string;
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
  needsAttention?: boolean;
  attentionUpdatedAt?: string;
  attentionUnreadMessageCount?: number;
  attentionUnreadActivityCount?: number;
  attentionActivityIds?: string[];
  deferredResumes?: DeferredResumeSummary[];
}

export interface CompanionConversationListResult {
  live: SessionMeta[];
  needsReview: SessionMeta[];
  active: SessionMeta[];
  archived: SessionMeta[];
  archivedTotal: number;
  archivedOffset: number;
  archivedLimit: number;
  hasMoreArchived: boolean;
  workspaceSessionIds: string[];
}

export type DisplayBlock =
  | { type: 'user';     id: string; ts: string; text: string; images?: MessageImage[] }
  | { type: 'text';     id: string; ts: string; text: string }
  | { type: 'context';  id: string; ts: string; text: string; customType?: string }
  | { type: 'summary';  id: string; ts: string; kind: 'compaction' | 'branch'; title: string; text: string }
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
}

export interface ConversationTreeNode {
  id: string;
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'summary' | 'error' | 'custom';
  label: string;
  preview: string;
  ts: string;
  blockIndex: number | null;
  active: boolean;
  onActivePath: boolean;
  children: ConversationTreeNode[];
}

export interface ConversationTreeSnapshot {
  leafId: string | null;
  roots: ConversationTreeNode[];
}

export type AppEventTopic =
  | 'activity'
  | 'alerts'
  | 'projects'
  | 'sessions'
  | 'sessionFiles'
  | 'artifacts'
  | 'attachments'
  | 'tasks'
  | 'runs'
  | 'daemon'
  | 'sync'
  | 'webUi'
  | 'executionTargets'
  | 'workspace';

export type AppEvent =
  | { type: 'connected' }
  | { type: 'invalidate'; topics: AppEventTopic[] }
  | { type: 'live_title'; sessionId: string; title: string }
  | { type: 'session_meta_changed'; sessionId: string }
  | { type: 'activity_snapshot'; entries: ActivityEntry[]; unreadCount: number }
  | { type: 'alerts_snapshot'; entries: AlertEntry[]; activeCount: number }
  | { type: 'projects_snapshot'; projects: ProjectRecord[] }
  | { type: 'sessions_snapshot'; sessions: SessionMeta[] }
  | { type: 'tasks_snapshot'; tasks: ScheduledTaskSummary[] }
  | { type: 'runs_snapshot'; result: DurableRunListResult }
  | { type: 'daemon_snapshot'; state: DaemonState }
  | { type: 'sync_snapshot'; state: SyncState }
  | { type: 'web_ui_snapshot'; state: WebUiState };

// ── Live session ──────────────────────────────────────────────────────────────

export interface GitWorkingTreeChange {
  relativePath: string;
  change: WorkspaceChangeKind;
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
  projects: ConversationProjectLinks;
  execution: ConversationExecutionState;
  remoteConnection: RemoteConversationConnectionState;
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
  delivery?: {
    alertLevel: 'none' | 'passive' | 'disruptive';
    autoResumeIfOpen: boolean;
    requireAck: boolean;
  };
}

export interface ConversationCwdChangeResult {
  id: string;
  sessionFile: string;
  cwd: string;
  changed: boolean;
}

export interface FolderPickerResult {
  path: string | null;
  cancelled: boolean;
}

export interface RemoteFolderEntry {
  name: string;
  path: string;
}

export interface RemoteFolderListing {
  cwd: string;
  parent: string | null;
  entries: RemoteFolderEntry[];
}

// ── Workspace browser ───────────────────────────────────────────────────────

export type WorkspaceChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'conflicted';

export interface WorkspaceTreeNode {
  name: string;
  path: string;
  relativePath: string;
  kind: 'directory' | 'file';
  exists: boolean;
  change: WorkspaceChangeKind | null;
  children?: WorkspaceTreeNode[];
}

export interface WorkspaceChangeEntry {
  path: string;
  relativePath: string;
  exists: boolean;
  change: WorkspaceChangeKind;
}

export interface WorkspaceSnapshot {
  cwd: string;
  root: string;
  repoRoot: string | null;
  branch: string | null;
  focusPath: string | null;
  fileCount: number;
  changedCount: number;
  truncated: boolean;
  tree: WorkspaceTreeNode[];
  changes: WorkspaceChangeEntry[];
}

export interface WorkspaceFileDetail {
  cwd: string;
  root: string;
  repoRoot: string | null;
  path: string;
  relativePath: string;
  exists: boolean;
  sizeBytes: number;
  binary: boolean;
  tooLarge: boolean;
  content: string | null;
  originalContent: string | null;
  change: WorkspaceChangeKind | null;
  diff: string | null;
}

export type WorkspaceGitScope = 'staged' | 'unstaged' | 'untracked' | 'conflicted';

export interface WorkspaceGitStatusEntry {
  path: string;
  relativePath: string;
  exists: boolean;
  stagedChange: WorkspaceChangeKind | null;
  unstagedChange: WorkspaceChangeKind | null;
  oldRelativePath: string | null;
}

export interface WorkspaceGitStatusSummary {
  cwd: string;
  root: string;
  repoRoot: string | null;
  branch: string | null;
  focusPath: string | null;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  entries: WorkspaceGitStatusEntry[];
}

export interface WorkspaceGitDiffDetail {
  cwd: string;
  root: string;
  repoRoot: string;
  branch: string | null;
  path: string;
  relativePath: string;
  exists: boolean;
  scope: WorkspaceGitScope;
  change: WorkspaceChangeKind | null;
  oldRelativePath: string | null;
  diff: string;
}

export interface WorkspaceCommitDraftResult {
  subject: string;
  body: string | null;
  message: string;
  source: 'ai' | 'fallback';
  notice: string | null;
}

export interface WorkspaceGitCommitResult {
  cwd: string;
  root: string;
  repoRoot: string;
  branch: string | null;
  commitSha: string;
  subject: string;
  body: string | null;
}

export interface LiveSessionMeta {
  id:                   string;
  cwd:                  string;
  sessionFile:          string;
  title?:               string;
  isStreaming:          boolean;
  hasPendingHiddenTurn?: boolean;
}

export interface CompanionAuthSessionSummary {
  id: string;
  deviceLabel: string;
  surface: 'companion' | 'desktop';
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface CompanionAuthAdminState {
  pendingPairings: Array<{
    id: string;
    createdAt: string;
    expiresAt: string;
  }>;
  sessions: CompanionAuthSessionSummary[];
}

export interface CompanionPairingCodeResult {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string;
}

export interface CompanionAuthSessionState {
  session: CompanionAuthSessionSummary;
}

export interface DesktopAuthSessionState {
  required: boolean;
  session: CompanionAuthSessionSummary | null;
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
}

// ── SSE events from /api/live-sessions/:id/events ────────────────────────────

export type SseEvent =
  | { type: 'snapshot';        blocks: DisplayBlock[]; blockOffset: number; totalBlocks: number }
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_end' }
  | { type: 'user_message';    block: Extract<DisplayBlock, { type: 'user' }> }
  | { type: 'queue_state';     steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] }
  | { type: 'presence_state';  state: LiveSessionPresenceState }
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

export interface ExecutionTargetPathMapping {
  localPrefix: string;
  remotePrefix: string;
}

export interface ExecutionTargetSummary {
  id: string;
  label: string;
  description?: string;
  transport: 'ssh';
  sshDestination: string;
  sshCommand?: string;
  remotePaCommand?: string;
  profile?: string;
  defaultRemoteCwd?: string;
  commandPrefix?: string;
  cwdMappings: ExecutionTargetPathMapping[];
  createdAt: string;
  updatedAt: string;
  activeRunCount: number;
  readyImportCount: number;
  latestRunAt?: string;
}

export interface ExecutionTargetsState {
  targets: ExecutionTargetSummary[];
  sshBinary: CliBinaryState;
  summary: {
    totalTargets: number;
    activeRemoteRuns: number;
    readyImports: number;
  };
}

export interface ConversationExecutionState {
  conversationId: string;
  targetId: string | null;
  location: 'local' | 'remote';
  target: ExecutionTargetSummary | null;
}

export interface RemoteConversationConnectionState {
  conversationId: string;
  targetId: string | null;
  connected: boolean;
  state: 'local' | 'idle' | 'installing' | 'connecting' | 'connected' | 'error';
  message: string | null;
  updatedAt: string | null;
}

export type RemoteConversationConnectionStreamEvent =
  | { type: 'snapshot'; data: RemoteConversationConnectionState };

export interface AppStatus {
  profile: string;
  repoRoot: string;
  activityCount: number;
  projectCount: number;
  webUiSlot?: string;
  webUiRevision?: string;
}

export interface ApplicationRestartRequestResult {
  accepted: true;
  message: string;
  requestedAt: string;
  logFile: string;
}

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  context: number;
}

export interface ModelState {
  currentModel: string;
  currentThinkingLevel: string;
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
  source: 'env' | 'config' | 'default';
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

export interface CodexPlanUsageWindow {
  remainingPercent: number;
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: string | null;
}

export interface CodexPlanCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export interface CodexPlanUsageState {
  available: boolean;
  planType: string | null;
  fiveHour: CodexPlanUsageWindow | null;
  weekly: CodexPlanUsageWindow | null;
  credits: CodexPlanCredits | null;
  updatedAt: string | null;
  error: string | null;
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

export interface ProfileState {
  currentProfile: string;
  profiles: string[];
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

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'remote';
  command?: string;
  args: string[];
  cwd?: string;
  url?: string;
  env?: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface McpState {
  configPath: string;
  configExists: boolean;
  searchedPaths: string[];
  servers: McpServerConfig[];
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
