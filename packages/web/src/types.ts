export interface MessageImage {
  alt: string;
  src?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  caption?: string;
}

export interface PromptImageInput {
  name?: string;
  mimeType: string;
  data: string;
  previewUrl?: string;
}

export type MessageBlock =
  | { type: 'user';      id?: string; ts: string; text: string; images?: MessageImage[] }
  | { type: 'text';      id?: string; ts: string; text: string; streaming?: boolean }
  | { type: 'thinking';  id?: string; ts: string; text: string }
  | { type: 'tool_use';  id?: string; ts: string; tool: string; input: Record<string, unknown>; output: string; durationMs?: number; running?: boolean; status?: 'running' | 'ok' | 'error'; error?: boolean; _toolCallId?: string }
  | { type: 'subagent';  id?: string; ts: string; name: string; prompt: string; status: 'running' | 'complete' | 'failed'; summary?: string }
  | { type: 'image';     id?: string; ts: string; alt: string; src?: string; mimeType?: string; width?: number; height?: number; caption?: string }
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

export interface ProjectRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  description: string;
  repoRoot?: string;
  summary: string;
  status: string;
  blockers: string[];
  currentFocus?: string;
  recentProgress: string[];
  plan: ProjectPlan;
}

export interface ProjectTask {
  id: string;
  status: string;
  title: string;
  milestoneId: string;
}

export interface ProjectDetail {
  project: ProjectRecord;
  taskCount: number;
  artifactCount: number;
  tasks: ProjectTask[];
}

export interface ScheduledTaskSummary {
  id: string;
  filePath: string;
  scheduleType: string;
  running: boolean;
  enabled: boolean;
  cron?: string;
  prompt: string;
  model?: string;
  lastStatus?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastAttemptCount?: number;
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

export interface GatewayAccessSummary {
  tokenConfigured: boolean;
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
  warnings: string[];
  service: GatewayServiceSummary;
  access: GatewayAccessSummary;
  conversations: GatewayConversationSummary[];
  pendingMessages: GatewayPendingMessageSummary[];
  gatewayLog: GatewayLogTail;
  daemonLog?: GatewayLogTail;
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

export interface WebUiDeploymentSummary {
  stablePort: number;
  activeSlot?: 'blue' | 'green';
  activeRelease?: WebUiReleaseSummary;
  inactiveRelease?: WebUiReleaseSummary;
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
  needsAttention?: boolean;
  attentionUpdatedAt?: string;
  attentionUnreadMessageCount?: number;
  attentionUnreadActivityCount?: number;
  attentionActivityIds?: string[];
}

export type DisplayBlock =
  | { type: 'user';     id: string; ts: string; text: string; images?: MessageImage[] }
  | { type: 'text';     id: string; ts: string; text: string }
  | { type: 'thinking'; id: string; ts: string; text: string }
  | { type: 'tool_use'; id: string; ts: string; tool: string; input: Record<string, unknown>; output: string; durationMs?: number; toolCallId: string }
  | { type: 'image';    id: string; ts: string; alt: string; src?: string; mimeType?: string; width?: number; height?: number; caption?: string }
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
  contextUsage: SessionContextUsage | null;
}

export type AppEventTopic = 'activity' | 'projects' | 'sessions' | 'tasks';

export type AppEvent =
  | { type: 'connected' }
  | { type: 'invalidate'; topics: AppEventTopic[] }
  | { type: 'live_title'; sessionId: string; title: string }
  | { type: 'activity_snapshot'; entries: ActivityEntry[]; unreadCount: number }
  | { type: 'projects_snapshot'; projects: ProjectRecord[] }
  | { type: 'sessions_snapshot'; sessions: SessionMeta[] }
  | { type: 'tasks_snapshot'; tasks: ScheduledTaskSummary[] };

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

export interface LiveSessionMeta {
  id:          string;
  cwd:         string;
  sessionFile: string;
  title?:      string;
  isStreaming: boolean;
}

// ── SSE events from /api/live-sessions/:id/events ────────────────────────────

export type SseEvent =
  | { type: 'snapshot';        blocks: DisplayBlock[] }
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_end' }
  | { type: 'user_message';    block: Extract<DisplayBlock, { type: 'user' }> }
  | { type: 'queue_state';     steering: string[]; followUp: string[] }
  | { type: 'text_delta';      delta: string }
  | { type: 'thinking_delta';  delta: string }
  | { type: 'tool_start';      toolCallId: string; toolName: string; args: Record<string, string> }
  | { type: 'tool_update';     toolCallId: string; partialResult: unknown }
  | { type: 'tool_end';        toolCallId: string; toolName: string; isError: boolean; durationMs: number; output: string }
  | { type: 'title_update';    title: string }
  | { type: 'context_usage';   usage: SessionContextUsage | null }
  | { type: 'stats_update';    tokens: { input: number; output: number; total: number }; cost: number }
  | { type: 'error';           message: string };

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
  updated?: string;
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

export interface AppStatus {
  profile: string;
  repoRoot: string;
  activityCount: number;
  projectCount: number;
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

export interface McpCliBinaryState {
  available: boolean;
  command: string;
  path?: string;
  version?: string;
  error?: string;
}

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

export interface ToolsState {
  profile: string;
  cwd: string;
  activeTools: string[];
  tools: AgentToolInfo[];
  mcpCli: McpCliState;
}
