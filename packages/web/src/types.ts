export interface ActivityEntry {
  id: string;
  createdAt: string;
  profile: string;
  kind: string;
  summary: string;
  details?: string;
  relatedWorkstreamIds?: string[];
  relatedConversationIds?: string[];
  notificationState?: string;
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
  taskCount: number;
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
  | { type: 'user';     id: string; ts: string; text: string }
  | { type: 'text';     id: string; ts: string; text: string }
  | { type: 'thinking'; id: string; ts: string; text: string }
  | { type: 'tool_use'; id: string; ts: string; tool: string; input: Record<string, unknown>; output: string; durationMs?: number; toolCallId: string }
  | { type: 'error';    id: string; ts: string; tool?: string; message: string };

export interface SessionDetail {
  meta: SessionMeta;
  blocks: DisplayBlock[];
}

// ── App status ─────────────────────────────────────────────────────────────────

// ── Live session ──────────────────────────────────────────────────────────────

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
