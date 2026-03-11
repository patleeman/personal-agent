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
  relatedWorkstreamIds?: string[];
  relatedConversationIds?: string[];
  notificationState?: string;
}

export interface ProjectSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  title: string;
  objective: string;
  currentStatus: string;
  blockers?: string;
  nextActions?: string;
  relatedConversationIds?: string[];
}

export interface ProjectPlanStep {
  text: string;
  completed: boolean;
}

export interface ProjectPlan {
  id: string;
  updatedAt: string;
  objective: string;
  steps: ProjectPlanStep[];
}

export type ProjectTaskStatus = 'backlog' | 'ready' | 'running' | 'blocked' | 'done' | 'cancelled' | string;

export interface ProjectTaskCriterionValidation {
  criterion: string;
  status: 'pass' | 'fail' | 'pending' | string;
  evidence: string;
}

export interface ProjectTaskSummary {
  taskId: string;
  createdAt: string;
  updatedAt: string;
  outcome: string;
  summary: string;
  criteriaValidation?: ProjectTaskCriterionValidation[];
  keyChanges?: string[];
  artifacts?: string[];
  followUps?: string[];
}

export interface ProjectTask {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectTaskStatus;
  title: string;
  objective: string;
  acceptanceCriteria?: string[];
  dependencies?: string[];
  notes?: string;
  relatedConversationIds?: string[];
  summary?: ProjectTaskSummary;
}

export interface ProjectDetail {
  id: string;
  project: ProjectSummary;
  plan: ProjectPlan;
  tasks: ProjectTask[];
  artifactCount: number;
}

export interface WorkstreamSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  objective: string;
  currentPlan: string;
  status: string;
  blockers: string;
  completedItems?: string;
  openTasks?: string;
}

export interface WorkstreamPlanStep {
  text: string;
  completed: boolean;
}

export interface WorkstreamPlan {
  id: string;
  updatedAt: string;
  objective: string;
  steps: WorkstreamPlanStep[];
}

export interface WorkstreamDetail {
  id: string;
  summary: WorkstreamSummary;
  plan: WorkstreamPlan;
  todoCount: number;
  artifactCount: number;
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

// ── App status ─────────────────────────────────────────────────────────────────

// ── Live session ──────────────────────────────────────────────────────────────

export interface LiveSessionContext {
  cwd: string;
  branch: string | null;
  userMessages: Array<{ id: string; ts: string; text: string; imageCount: number }>;
  relatedWorkstreamIds: string[];
}

export interface ConversationWorkstreamLinks {
  conversationId: string;
  relatedWorkstreamIds: string[];
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
  workstreamCount: number;
}

export interface ProfileState {
  currentProfile: string;
  profiles: string[];
}
