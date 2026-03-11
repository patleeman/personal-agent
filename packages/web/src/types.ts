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
}

export interface ProjectRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  description: string;
  summary: string;
  status: string;
  blockers: string[];
  currentFocus?: string;
  recentProgress: string[];
  plan: ProjectPlan;
}

export interface ProjectTask {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  title: string;
  summary?: string;
  order?: number;
  milestoneId?: string;
  acceptanceCriteria?: string[];
  plan?: string[];
  notes?: string;
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

export interface LiveSessionContext {
  cwd: string;
  branch: string | null;
  userMessages: Array<{ id: string; ts: string; text: string; imageCount: number }>;
  relatedProjectIds: string[];
}

export interface ConversationProjectLinks {
  conversationId: string;
  relatedProjectIds: string[];
}

export interface LiveSessionMeta {
  id:          string;
  cwd:         string;
  sessionFile: string;
  isStreaming: boolean;
}

// ── SSE events from /api/live-sessions/:id/events ────────────────────────────

export type SseEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_end' }
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
}

export interface MemorySkillItem {
  source: string;
  name: string;
  description: string;
  path: string;
}

export interface MemoryDocItem {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  path: string;
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

export interface ProfileState {
  currentProfile: string;
  profiles: string[];
}
