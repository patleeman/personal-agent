type FlexibleString = string & Record<never, never>;
export type ProjectStatus = 'active' | 'paused' | 'done' | 'created' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export type ProjectMilestoneStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export type ProjectTaskStatus = 'todo' | 'doing' | 'done' | 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export interface ProjectMilestoneDocument {
  id: string;
  title: string;
  status: ProjectMilestoneStatus | FlexibleString;
  summary?: string;
}
export interface ProjectTaskDocument {
  id: string;
  status: ProjectTaskStatus | FlexibleString;
  title: string;
  milestoneId?: string;
}
export interface ProjectPlanDocument {
  currentMilestoneId?: string;
  milestones: ProjectMilestoneDocument[];
  tasks: ProjectTaskDocument[];
}
export interface ProjectRequirementsDocument {
  goal: string;
  acceptanceCriteria: string[];
}
export interface ProjectDocument {
  id: string;
  ownerProfile: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  title: string;
  description: string;
  repoRoot?: string;
  summary: string;
  requirements: ProjectRequirementsDocument;
  status: ProjectStatus | FlexibleString;
  blockers: string[];
  currentFocus?: string;
  recentProgress: string[];
  planSummary?: string;
  completionSummary?: string;
  plan: ProjectPlanDocument;
}
export type ProjectActivityKind =
  | 'scheduled-task'
  | 'deferred-resume'
  | 'subagent-run'
  | 'background-run'
  | 'deployment'
  | 'service'
  | 'verification'
  | 'follow-up'
  | 'note';
export type ProjectActivityNotificationState = 'none' | 'queued' | 'sent' | 'failed';
export interface ProjectActivityEntryDocument {
  id: string;
  createdAt: string;
  profile: string;
  kind: ProjectActivityKind | FlexibleString;
  summary: string;
  details?: string;
  relatedProjectIds?: string[];
  notificationState?: ProjectActivityNotificationState;
}
export declare function createInitialProject(input: {
  id: string;
  ownerProfile: string;
  title: string;
  description: string;
  repoRoot?: string;
  createdAt: string;
  updatedAt?: string;
}): ProjectDocument;
export declare function formatProject(document: ProjectDocument): string;
export declare function parseProject(yaml: string, baseDocument?: ProjectDocument): ProjectDocument;
export declare function readProject(path: string): ProjectDocument;
export declare function readProjectIndexBody(path: string): string | null;
export declare function writeProjectIndexBody(path: string, document: ProjectDocument, body: string): void;
export declare function writeProject(path: string, document: ProjectDocument): void;
export declare function createProjectActivityEntry(input: {
  id: string;
  createdAt: string;
  profile: string;
  kind: ProjectActivityEntryDocument['kind'];
  summary: string;
  details?: string;
  relatedProjectIds?: string[];
  notificationState?: ProjectActivityNotificationState;
}): ProjectActivityEntryDocument;
export declare function formatProjectActivityEntry(document: ProjectActivityEntryDocument): string;
export declare function parseProjectActivityEntry(markdown: string): ProjectActivityEntryDocument;
export declare function readProjectActivityEntry(path: string): ProjectActivityEntryDocument;
export declare function writeProjectActivityEntry(path: string, document: ProjectActivityEntryDocument): void;
export declare function createProjectTask(input: {
  id: string;
  status: ProjectTaskDocument['status'];
  title: string;
  milestoneId?: string;
}): ProjectTaskDocument;
export declare function formatProjectTask(document: ProjectTaskDocument): string;
export declare function parseProjectTask(yaml: string): ProjectTaskDocument;
export declare function readProjectTask(path: string): ProjectTaskDocument;
export declare function writeProjectTask(path: string, document: ProjectTaskDocument): void;
export {};
