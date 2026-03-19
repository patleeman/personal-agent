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

export interface ProjectBrief {
  path: string;
  content: string;
  updatedAt: string;
}

export interface ProjectNote {
  id: string;
  path: string;
  title: string;
  kind: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  id: string;
  kind: 'attachment' | 'artifact';
  path: string;
  title: string;
  description?: string;
  originalName: string;
  mimeType?: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  downloadPath: string;
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
  kind: 'brief' | 'note' | 'attachment' | 'artifact' | 'conversation' | 'activity';
  createdAt: string;
  title: string;
  description?: string;
  href?: string;
}

export interface ProjectDetail {
  profile: string;
  project: ProjectRecord;
  taskCount: number;
  noteCount: number;
  attachmentCount: number;
  artifactCount: number;
  tasks: ProjectTask[];
  brief: ProjectBrief | null;
  notes: ProjectNote[];
  attachments: ProjectFile[];
  artifacts: ProjectFile[];
  linkedConversations: ProjectLinkedConversation[];
  timeline: ProjectTimelineEntry[];
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

export interface DurableRunRecord {
  runId: string;
  paths: DurableRunPaths;
  manifest?: DurableRunManifest;
  status?: DurableRunStatusRecord;
  checkpoint?: DurableRunCheckpoint;
  problems: string[];
  recoveryAction: string;
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

export interface GatewayServiceSummary {
  provider: 'telegram';
  platform: string;
  identifier: string;
  manifestPath: string;
  installed: boolean;
  running: boolean;
  logFile?: string;
  error?: string;
  daemonService?: {
    identifier: string;
    manifestPath: string;
    installed: boolean;
    running: boolean;
    logFile?: string;
  };
}

export type GatewayTokenSource = 'missing' | 'plain' | 'one-password';

export interface GatewayAccessSummary {
  tokenConfigured: boolean;
  tokenSource: GatewayTokenSource;
  tokenPreview?: string;
  defaultModel?: string;
  allowlistChatIds: string[];
  allowedUserIds: string[];
  blockedUserIds: string[];
  workingDirectory?: string;
  maxPendingPerChat?: number;
  toolActivityStream?: boolean;
  clearRecentMessagesOnNew?: boolean;
}

export interface GatewayWorkTopicSummary {
  sourceConversationId: string;
  workConversationId: string;
  topicName: string;
  updatedAt: string;
}

export interface GatewayConversationSummary {
  conversationId: string;
  label: string;
  chatId: string;
  messageThreadId?: number;
  sessionFile: string;
  sessionMissing: boolean;
  sessionOverride: boolean;
  title: string;
  messageCount: number;
  model: string;
  cwd: string;
  lastActivityAt: string;
  bindingUpdatedAt?: string;
  workTopic?: GatewayWorkTopicSummary;
  sourceWorkTopic?: GatewayWorkTopicSummary;
}

export interface GatewayPendingMessageSummary {
  id: string;
  storedAt: string;
  conversationId: string;
  chatId: string;
  messageThreadId?: number;
  senderLabel?: string;
  preview: string;
  hasMedia: boolean;
}

export interface GatewayLogTail {
  path?: string;
  lines: string[];
}

export interface GatewayState {
  provider: 'telegram';
  currentProfile: string;
  configuredProfile: string;
  configFilePath: string;
  envOverrideKeys: string[];
  warnings: string[];
  service: GatewayServiceSummary;
  access: GatewayAccessSummary;
  conversations: GatewayConversationSummary[];
  pendingMessages: GatewayPendingMessageSummary[];
  gatewayLog: GatewayLogTail;
  daemonLog?: GatewayLogTail;
}

export interface GatewayConfigUpdateInput {
  profile: string;
  defaultModel?: string;
  token?: string;
  clearToken?: boolean;
  allowlistChatIds: string[];
  allowedUserIds: string[];
  blockedUserIds: string[];
  workingDirectory?: string | null;
  maxPendingPerChat?: number | null;
  toolActivityStream: boolean;
  clearRecentMessagesOnNew: boolean;
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
  log: GatewayLogTail;
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
  log: GatewayLogTail;
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
  tailscaleServe: boolean;
  tailscaleUrl?: string;
  resumeFallbackPrompt: string;
  deployment?: WebUiDeploymentSummary;
}

export interface WebUiState {
  warnings: string[];
  service: WebUiServiceSummary;
  log: GatewayLogTail;
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

export type DisplayBlock =
  | { type: 'user';     id: string; ts: string; text: string; images?: MessageImage[] }
  | { type: 'text';     id: string; ts: string; text: string }
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

export type AppEventTopic = 'activity' | 'projects' | 'sessions' | 'tasks' | 'runs';

export type AppEvent =
  | { type: 'connected' }
  | { type: 'invalidate'; topics: AppEventTopic[] }
  | { type: 'live_title'; sessionId: string; title: string }
  | { type: 'activity_snapshot'; entries: ActivityEntry[]; unreadCount: number }
  | { type: 'projects_snapshot'; projects: ProjectRecord[] }
  | { type: 'sessions_snapshot'; sessions: SessionMeta[] }
  | { type: 'tasks_snapshot'; tasks: ScheduledTaskSummary[] }
  | { type: 'runs_snapshot'; result: DurableRunListResult };

// ── Live session ──────────────────────────────────────────────────────────────

export interface GitWorkingTreeSummary {
  changeCount: number;
  linesAdded: number;
  linesDeleted: number;
}

export interface LiveSessionContext {
  cwd: string;
  branch: string | null;
  git: GitWorkingTreeSummary | null;
  userMessages: Array<{ id: string; ts: string; text: string; imageCount: number }>;
  relatedProjectIds: string[];
}

export interface ConversationProjectLinks {
  conversationId: string;
  relatedProjectIds: string[];
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

export interface LiveSessionMeta {
  id:          string;
  cwd:         string;
  sessionFile: string;
  title?:      string;
  isStreaming: boolean;
}

// ── SSE events from /api/live-sessions/:id/events ────────────────────────────

export type SseEvent =
  | { type: 'snapshot';        blocks: DisplayBlock[]; blockOffset: number; totalBlocks: number }
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_end' }
  | { type: 'user_message';    block: Extract<DisplayBlock, { type: 'user' }> }
  | { type: 'queue_state';     steering: string[]; followUp: string[] }
  | { type: 'text_delta';      delta: string }
  | { type: 'thinking_delta';  delta: string }
  | { type: 'tool_start';      toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_update';     toolCallId: string; partialResult: unknown }
  | { type: 'tool_end';        toolCallId: string; toolName: string; isError: boolean; durationMs: number; output: string; details?: unknown }
  | { type: 'title_update';    title: string }
  | { type: 'context_usage';   usage: SessionContextUsage | null }
  | { type: 'stats_update';    tokens: { input: number; output: number; total: number }; cost: number }
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
  tags: string[];
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

export interface MemoryReferenceItem {
  title: string;
  summary: string;
  tags: string[];
  path: string;
  relativePath: string;
  updated?: string;
}

export interface MemoryDocDetail {
  memory: MemoryDocItem;
  content: string;
  references: MemoryReferenceItem[];
}

export interface MemoryWorkItem {
  conversationId: string;
  conversationTitle: string;
  runId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface MemoryData {
  profile: string;
  agentsMd: MemoryAgentsItem[];
  skills: MemorySkillItem[];
  memoryDocs: MemoryDocItem[];
}

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

export interface DefaultCwdState {
  currentCwd: string;
  effectiveCwd: string;
}

export type ProviderAuthType = 'none' | 'api_key' | 'oauth' | 'environment';

export interface ProviderAuthSummary {
  id: string;
  modelCount: number;
  authType: ProviderAuthType;
  hasStoredCredential: boolean;
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

export interface ConversationTitleSettingsState {
  enabled: boolean;
  currentModel: string;
  effectiveModel: string;
}

export interface ConversationAutomationJudgeSettingsState {
  currentModel: string;
  effectiveModel: string;
  systemPrompt: string;
  usingDefaultSystemPrompt: boolean;
}

export interface ConversationAutomationPreferencesState {
  defaultEnabled: boolean;
}

export type ConversationAutomationSkillStepStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ConversationAutomationGateStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ConversationAutomationTemplateSkillStep {
  id: string;
  label: string;
  skillName: string;
  skillArgs?: string;
}

export interface ConversationAutomationTemplateGate {
  id: string;
  label: string;
  prompt: string;
  skills: ConversationAutomationTemplateSkillStep[];
}

export interface ConversationAutomationSkillStep {
  id: string;
  label: string;
  skillName: string;
  skillArgs?: string;
  status: ConversationAutomationSkillStepStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  resultReason?: string;
  resultConfidence?: number;
}

export interface ConversationAutomationGate {
  id: string;
  label: string;
  prompt: string;
  status: ConversationAutomationGateStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  resultReason?: string;
  resultConfidence?: number;
  matchesCurrentConditions?: boolean;
  skills: ConversationAutomationSkillStep[];
}

export interface ConversationAutomationWorkflowPreset {
  id: string;
  name: string;
  updatedAt: string;
  gates: ConversationAutomationTemplateGate[];
}

export interface ConversationAutomationWorkflowPresetLibraryState {
  presets: ConversationAutomationWorkflowPreset[];
  defaultPresetIds: string[];
}

export interface ConversationAutomationState {
  conversationId: string;
  enabled: boolean;
  activeGateId: string | null;
  activeSkillId: string | null;
  updatedAt: string;
  gates: ConversationAutomationGate[];
}

export interface ConversationAutomationSkillInfo {
  name: string;
  description: string;
  source: string;
}

export interface ConversationAutomationFilterHelpField {
  key: 'tool' | 'event' | 'repo' | 'prompt' | 'judge';
  description: string;
  valueHint: string;
  values?: string[];
}

export interface ConversationAutomationFilterHelpTool {
  name: string;
  description: string;
}

export interface ConversationAutomationFilterHelp {
  fields: ConversationAutomationFilterHelpField[];
  examples: string[];
  availableTools: ConversationAutomationFilterHelpTool[];
}

export interface ConversationAutomationFilterValidationResult {
  valid: boolean;
  error: string | null;
}

export interface ConversationAutomationResponse {
  conversationId: string;
  live: boolean;
  inheritedPresetIds: string[];
  automation: ConversationAutomationState;
  presetLibrary: ConversationAutomationWorkflowPresetLibraryState;
  skills: ConversationAutomationSkillInfo[];
  judge: ConversationAutomationJudgeSettingsState;
}

export interface ConversationAutomationWorkspaceState {
  presetLibrary: ConversationAutomationWorkflowPresetLibraryState;
  skills: ConversationAutomationSkillInfo[];
  judge: ConversationAutomationJudgeSettingsState;
  filterHelp: ConversationAutomationFilterHelp;
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

export type McpCliBinaryState = CliBinaryState;

export interface McpCliServerConfig {
  name: string;
  command?: string;
  args: string[];
  cwd?: string;
  url?: string;
  env?: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface McpCliState {
  binary: McpCliBinaryState;
  configPath: string;
  configExists: boolean;
  searchedPaths: string[];
  servers: McpCliServerConfig[];
}

export interface McpCliServerToolSummary {
  name: string;
}

export interface McpCliServerDetail {
  server?: string;
  transport?: string;
  commandLine?: string;
  toolCount?: number;
  tools: McpCliServerToolSummary[];
  rawOutput: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface McpCliToolDetail {
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
  mcpCli: McpCliState;
  packageInstall: PackageInstallState;
}
