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

export interface AppStatus {
  profile: string;
  repoRoot: string;
  activityCount: number;
  workstreamCount: number;
}
