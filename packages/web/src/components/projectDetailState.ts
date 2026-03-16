import type { ProjectDetail, ProjectMilestone, ProjectNote, ProjectTask } from '../types';

export const UNASSIGNED_TASK_KEY = '__unassigned__';

export interface ProjectFormState {
  title: string;
  description: string;
  repoRoot: string;
  summary: string;
  goal: string;
  acceptanceCriteria: string;
  planSummary: string;
  completionSummary: string;
  status: string;
  currentFocus: string;
  blockers: string;
  recentProgress: string;
}

export interface MilestoneFormState {
  title: string;
  status: string;
  summary: string;
  makeCurrent: boolean;
}

export interface TaskFormState {
  title: string;
  status: string;
  milestoneId: string;
}

export interface NoteFormState {
  title: string;
  kind: string;
  body: string;
}

export interface FileUploadState {
  kind: 'attachment' | 'artifact';
  title: string;
  description: string;
  file: File | null;
}

export type ProjectMilestoneEditorState = { mode: 'add' } | { mode: 'edit'; milestoneId: string };

export type ProjectTaskEditorState =
  | { mode: 'add'; anchorMilestoneId?: string }
  | { mode: 'edit'; taskId: string; anchorMilestoneId?: string };

export type ProjectNoteEditorState = { mode: 'add' } | { mode: 'edit'; noteId: string };

export type ProjectActivityItemShape =
  | {
      id: string;
      kind: 'conversation';
      conversation: ProjectDetail['linkedConversations'][number];
    }
  | {
      id: string;
      kind: 'timeline';
      entry: ProjectDetail['timeline'][number];
    };

export function projectFormFromDetail(project: ProjectDetail): ProjectFormState {
  return {
    title: project.project.title,
    description: project.project.description,
    repoRoot: project.project.repoRoot ?? '',
    summary: project.project.summary,
    goal: project.project.requirements.goal,
    acceptanceCriteria: project.project.requirements.acceptanceCriteria.join('\n'),
    planSummary: project.project.planSummary ?? '',
    completionSummary: project.project.completionSummary ?? '',
    status: project.project.status,
    currentFocus: project.project.currentFocus ?? '',
    blockers: project.project.blockers.join('\n'),
    recentProgress: project.project.recentProgress.join('\n'),
  };
}

export function emptyMilestoneForm(): MilestoneFormState {
  return {
    title: '',
    status: 'pending',
    summary: '',
    makeCurrent: false,
  };
}

export function milestoneFormFromMilestone(milestone: ProjectMilestone, isCurrent: boolean): MilestoneFormState {
  return {
    title: milestone.title,
    status: milestone.status,
    summary: milestone.summary ?? '',
    makeCurrent: isCurrent,
  };
}

export function emptyTaskForm(): TaskFormState {
  return {
    title: '',
    status: 'pending',
    milestoneId: '',
  };
}

export function taskFormFromTask(task: ProjectTask): TaskFormState {
  return {
    title: task.title,
    status: task.status,
    milestoneId: task.milestoneId ?? '',
  };
}

export function emptyNoteForm(): NoteFormState {
  return {
    title: '',
    kind: 'note',
    body: '',
  };
}

export function noteFormFromNote(note: ProjectNote): NoteFormState {
  return {
    title: note.title,
    kind: note.kind,
    body: note.body,
  };
}

export function emptyFileUploadState(): FileUploadState {
  return {
    kind: 'attachment',
    title: '',
    description: '',
    file: null,
  };
}

export function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function buildTasksByMilestone(tasks: ProjectTask[]): Map<string, ProjectTask[]> {
  const tasksByMilestone = new Map<string, ProjectTask[]>();

  tasks.forEach((task) => {
    const milestoneKey = task.milestoneId ?? UNASSIGNED_TASK_KEY;
    const existing = tasksByMilestone.get(milestoneKey) ?? [];
    existing.push(task);
    tasksByMilestone.set(milestoneKey, existing);
  });

  return tasksByMilestone;
}

function sortTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function summarizeActivityPreview(value: string | undefined, maxLength = 160): string | undefined {
  const normalized = (value ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\n{2,}/g, ' · ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized || normalized.replace(/[·•]/g, '').trim().length === 0) {
    return undefined;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function buildActivityItems(project: ProjectDetail): ProjectActivityItemShape[] {
  return [
    ...project.linkedConversations.map((conversation) => ({
      id: `conversation:${conversation.conversationId}`,
      sortAt: sortTimestamp(conversation.lastActivityAt),
      item: {
        id: `conversation:${conversation.conversationId}`,
        kind: 'conversation' as const,
        conversation,
      },
    })),
    ...project.timeline
      .filter((entry) => entry.kind !== 'conversation')
      .map((entry) => ({
        id: `timeline:${entry.id}`,
        sortAt: sortTimestamp(entry.createdAt),
        item: {
          id: `timeline:${entry.id}`,
          kind: 'timeline' as const,
          entry,
        },
      })),
  ]
    .sort((left, right) => {
      const leftMissing = left.sortAt <= 0;
      const rightMissing = right.sortAt <= 0;
      if (leftMissing !== rightMissing) {
        return leftMissing ? 1 : -1;
      }

      return left.sortAt - right.sortAt || left.id.localeCompare(right.id);
    })
    .map(({ item }) => item);
}
