import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  addConversationProjectLink,
  getConversationProjectLink,
  removeConversationProjectLink,
} from '@personal-agent/core';
import { invalidateAppTopics } from '../shared/appEvents.js';
import {
  addProjectMilestone,
  createProjectRecord,
  createProjectTaskRecord,
  deleteProjectMilestone,
  deleteProjectRecord,
  deleteProjectTaskRecord,
  listProjectIndex,
  moveProjectMilestone,
  moveProjectTaskRecord,
  projectExists,
  readProjectDetailFromProject,
  setProjectArchivedState,
  updateProjectMilestone,
  updateProjectRecord,
  updateProjectTaskRecord,
} from '../projects/projects.js';
import {
  createProjectNoteRecord,
  deleteProjectNoteRecord,
  saveProjectDocument,
  updateProjectNoteRecord,
} from '../projects/projectResources.js';

const PROJECT_ACTION_VALUES = [
  'list',
  'get',
  'create',
  'update',
  'delete',
  'archive',
  'unarchive',
  'reference',
  'unreference',
  'save_document',
  'create_note',
  'update_note',
  'delete_note',
  'add_milestone',
  'update_milestone',
  'delete_milestone',
  'move_milestone',
  'create_task',
  'update_task',
  'delete_task',
  'move_task',
] as const;

const MOVE_DIRECTION_VALUES = ['up', 'down'] as const;

type ProjectAction = (typeof PROJECT_ACTION_VALUES)[number];
type MoveDirection = (typeof MOVE_DIRECTION_VALUES)[number];

const ProjectToolParams = Type.Object({
  action: Type.Union(PROJECT_ACTION_VALUES.map((value) => Type.Literal(value))),
  projectId: Type.Optional(Type.String({ description: 'Project id, for example web-ui.' })),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  projectRepoRoot: Type.Optional(Type.String()),
  summary: Type.Optional(Type.String()),
  goal: Type.Optional(Type.String()),
  acceptanceCriteria: Type.Optional(Type.Array(Type.String())),
  planSummary: Type.Optional(Type.String()),
  completionSummary: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  currentFocus: Type.Optional(Type.String()),
  currentMilestoneId: Type.Optional(Type.String()),
  blockers: Type.Optional(Type.Array(Type.String())),
  recentProgress: Type.Optional(Type.Array(Type.String())),
  milestoneId: Type.Optional(Type.String()),
  taskId: Type.Optional(Type.String()),
  noteId: Type.Optional(Type.String()),
  kind: Type.Optional(Type.String()),
  body: Type.Optional(Type.String()),
  makeCurrent: Type.Optional(Type.Boolean()),
  direction: Type.Optional(Type.Union(MOVE_DIRECTION_VALUES.map((value) => Type.Literal(value)))),
});

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function readOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function formatConversationReferences(relatedProjectIds: string[]): string {
  return relatedProjectIds.length > 0
    ? relatedProjectIds.map((projectId) => `@${projectId}`).join(', ')
    : 'none';
}

function getConversationProjectIds(
  profile: string,
  conversationId: string,
  stateRoot?: string,
): string[] {
  return getConversationProjectLink({
    stateRoot,
    profile,
    conversationId,
  })?.relatedProjectIds ?? [];
}

function formatProjectList(profile: string, projectIds: string[], repoRoot?: string): string {
  const { projects } = listProjectIndex({ repoRoot, profile });
  if (projects.length === 0) {
    return `No projects found for profile ${profile}.`;
  }

  return [
    `Projects for profile ${profile}:`,
    ...projects.map((project) => {
      const referenced = projectIds.includes(project.id) ? ' [referenced]' : '';
      const archived = project.archivedAt ? ` · archived:${project.archivedAt}` : '';
      return `- @${project.id}${referenced} · ${project.title} · ${project.status}${archived}`;
    }),
  ].join('\n');
}

function formatProjectDetail(detail: ReturnType<typeof readProjectDetailFromProject>): string {
  const { project } = detail;
  const lines = [
    `Project @${project.id}`,
    `title: ${project.title}`,
    `status: ${project.status}`,
    `summary: ${project.summary}`,
  ];

  if (project.description) {
    lines.push(`description: ${project.description}`);
  }

  if (project.currentFocus) {
    lines.push(`currentFocus: ${project.currentFocus}`);
  }

  if (project.requirements.goal) {
    lines.push(`goal: ${project.requirements.goal}`);
  }

  if (project.requirements.acceptanceCriteria.length > 0) {
    lines.push(`acceptanceCriteria: ${project.requirements.acceptanceCriteria.join(' | ')}`);
  }

  if (project.planSummary) {
    lines.push(`planSummary: ${project.planSummary}`);
  }

  if (project.completionSummary) {
    lines.push(`completionSummary: ${project.completionSummary}`);
  }

  if (project.blockers.length > 0) {
    lines.push(`blockers: ${project.blockers.join(' | ')}`);
  }

  if (project.recentProgress.length > 0) {
    lines.push(`recentProgress: ${project.recentProgress.join(' | ')}`);
  }

  if (project.archivedAt) {
    lines.push(`archivedAt: ${project.archivedAt}`);
  }

  if (project.repoRoot) {
    lines.push(`repoRoot: ${project.repoRoot}`);
  }

  if (project.plan.currentMilestoneId) {
    lines.push(`currentMilestoneId: ${project.plan.currentMilestoneId}`);
  }

  if (project.plan.milestones.length > 0) {
    lines.push(`milestones: ${project.plan.milestones.map((milestone) => `${milestone.id}:${milestone.status}`).join(', ')}`);
  }

  if (detail.tasks.length > 0) {
    lines.push(`tasks: ${detail.tasks.map((task) => `${task.id}:${task.status}`).join(', ')}`);
  }

  if (detail.notes.length > 0) {
    lines.push(`notes: ${detail.notes.map((note) => note.id).join(', ')}`);
  }

  if (detail.document) {
    lines.push(`document: ${detail.document.path}`);
  }

  return lines.join('\n');
}

function readDirection(value: string | undefined): MoveDirection {
  const normalized = readRequiredString(value, 'direction');
  if (normalized !== 'up' && normalized !== 'down') {
    throw new Error(`Invalid direction: ${normalized}`);
  }

  return normalized;
}

export function createProjectAgentExtension(options: {
  repoRoot: string;
  stateRoot?: string;
  getCurrentProfile: () => string;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'project',
      label: 'Project',
      description: 'Inspect, manage, and reference durable projects for the active profile.',
      promptSnippet: 'Use the project tool for durable project CRUD, tasks, notes, document edits, files, and current-conversation references.',
      promptGuidelines: [
        'Use this tool for structured project management instead of hand-editing project state.yaml for normal cases.',
        'Use reference and unreference to manage current conversation ↔ project links.',
        'Use create/update/get/list/archive/unarchive for project state, create/update/delete_task for flat task management, and note/document actions for durable context.',
      ],
      parameters: ProjectToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const profile = options.getCurrentProfile();
          const conversationId = ctx.sessionManager.getSessionId();

          switch (params.action as ProjectAction) {
            case 'list': {
              const relatedProjectIds = getConversationProjectIds(profile, conversationId, options.stateRoot);
              const { projects } = listProjectIndex({ repoRoot: options.repoRoot, profile });
              return {
                content: [{ type: 'text' as const, text: formatProjectList(profile, relatedProjectIds, options.repoRoot) }],
                details: {
                  action: 'list',
                  profile,
                  projectCount: projects.length,
                  projectIds: projects.map((project) => project.id),
                },
              };
            }

            case 'get': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const detail = readProjectDetailFromProject({
                repoRoot: options.repoRoot,
                profile,
                projectId,
              });
              return {
                content: [{ type: 'text' as const, text: formatProjectDetail(detail) }],
                details: {
                  action: 'get',
                  profile,
                  projectId,
                  taskCount: detail.taskCount,
                  noteCount: detail.noteCount,
                },
              };
            }

            case 'create': {
              const detail = createProjectRecord({
                repoRoot: options.repoRoot,
                profile,
                projectId: readOptionalString(params.projectId),
                title: readRequiredString(params.title, 'title'),
                description: readOptionalString(params.description) ?? readOptionalString(params.body) ?? readRequiredString(params.title, 'title'),
                projectRepoRoot: params.projectRepoRoot,
                summary: params.summary,
                goal: params.goal,
                acceptanceCriteria: params.acceptanceCriteria,
                planSummary: params.planSummary,
                completionSummary: params.completionSummary,
                status: params.status,
                currentFocus: params.currentFocus,
                blockers: params.blockers,
                recentProgress: params.recentProgress,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Created project @${detail.project.id}.` }],
                details: {
                  action: 'create',
                  profile,
                  projectId: detail.project.id,
                },
              };
            }

            case 'update': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const detail = updateProjectRecord({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                title: params.title,
                description: params.description,
                projectRepoRoot: params.projectRepoRoot,
                summary: params.summary,
                goal: params.goal,
                acceptanceCriteria: params.acceptanceCriteria,
                planSummary: params.planSummary,
                completionSummary: params.completionSummary,
                status: params.status,
                currentFocus: params.currentFocus,
                currentMilestoneId: params.currentMilestoneId,
                blockers: params.blockers,
                recentProgress: params.recentProgress,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Updated project @${projectId}.` }],
                details: {
                  action: 'update',
                  profile,
                  projectId: detail.project.id,
                },
              };
            }

            case 'delete': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              deleteProjectRecord({
                repoRoot: options.repoRoot,
                profile,
                projectId,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Deleted project @${projectId}.` }],
                details: {
                  action: 'delete',
                  profile,
                  projectId,
                },
              };
            }

            case 'archive': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              setProjectArchivedState({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                archived: true,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Archived project @${projectId}.` }],
                details: {
                  action: 'archive',
                  profile,
                  projectId,
                },
              };
            }

            case 'unarchive': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              setProjectArchivedState({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                archived: false,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Restored project @${projectId}.` }],
                details: {
                  action: 'unarchive',
                  profile,
                  projectId,
                },
              };
            }

            case 'reference': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              if (!projectExists({ repoRoot: options.repoRoot, profile, projectId })) {
                throw new Error(`Project not found: ${projectId}`);
              }

              const document = addConversationProjectLink({
                stateRoot: options.stateRoot,
                profile,
                conversationId,
                projectId,
              });
              invalidateAppTopics('projects');

              return {
                content: [{ type: 'text' as const, text: `Referenced @${projectId} in this conversation.\nCurrent referenced projects: ${formatConversationReferences(document.relatedProjectIds)}` }],
                details: { action: 'reference', projectId, relatedProjectIds: document.relatedProjectIds },
              };
            }

            case 'unreference': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const document = removeConversationProjectLink({
                stateRoot: options.stateRoot,
                profile,
                conversationId,
                projectId,
              });
              invalidateAppTopics('projects');

              return {
                content: [{ type: 'text' as const, text: `Stopped referencing @${projectId} in this conversation.\nCurrent referenced projects: ${formatConversationReferences(document.relatedProjectIds)}` }],
                details: { action: 'unreference', projectId, relatedProjectIds: document.relatedProjectIds },
              };
            }

            case 'save_document': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const document = saveProjectDocument({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                content: readRequiredString(params.body, 'body'),
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Saved document for @${projectId}.` }],
                details: {
                  action: 'save_document',
                  profile,
                  projectId,
                  path: document.path,
                },
              };
            }

            case 'create_note': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const note = createProjectNoteRecord({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                title: readRequiredString(params.title, 'title'),
                kind: readRequiredString(params.kind, 'kind'),
                body: params.body,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Created note ${note.id} for @${projectId}.` }],
                details: {
                  action: 'create_note',
                  profile,
                  projectId,
                  noteId: note.id,
                },
              };
            }

            case 'update_note': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const noteId = readRequiredString(params.noteId, 'noteId');
              const note = updateProjectNoteRecord({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                noteId,
                title: params.title,
                kind: params.kind,
                body: params.body,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Updated note ${note.id} for @${projectId}.` }],
                details: {
                  action: 'update_note',
                  profile,
                  projectId,
                  noteId: note.id,
                },
              };
            }

            case 'delete_note': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const noteId = readRequiredString(params.noteId, 'noteId');
              deleteProjectNoteRecord({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                noteId,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Deleted note ${noteId} from @${projectId}.` }],
                details: {
                  action: 'delete_note',
                  profile,
                  projectId,
                  noteId,
                },
              };
            }

            case 'add_milestone': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const detail = addProjectMilestone({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                id: readOptionalString(params.milestoneId),
                title: readRequiredString(params.title, 'title'),
                status: readRequiredString(params.status, 'status'),
                summary: params.summary,
                makeCurrent: params.makeCurrent,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Added milestone to @${projectId}.` }],
                details: {
                  action: 'add_milestone',
                  profile,
                  projectId,
                  milestoneCount: detail.project.plan.milestones.length,
                },
              };
            }

            case 'update_milestone': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const milestoneId = readRequiredString(params.milestoneId, 'milestoneId');
              const detail = updateProjectMilestone({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                milestoneId,
                title: params.title,
                status: params.status,
                summary: params.summary,
                makeCurrent: params.makeCurrent,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Updated milestone ${milestoneId} in @${projectId}.` }],
                details: {
                  action: 'update_milestone',
                  profile,
                  projectId,
                  milestoneCount: detail.project.plan.milestones.length,
                },
              };
            }

            case 'delete_milestone': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const milestoneId = readRequiredString(params.milestoneId, 'milestoneId');
              const detail = deleteProjectMilestone({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                milestoneId,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Deleted milestone ${milestoneId} from @${projectId}.` }],
                details: {
                  action: 'delete_milestone',
                  profile,
                  projectId,
                  milestoneCount: detail.project.plan.milestones.length,
                },
              };
            }

            case 'move_milestone': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const milestoneId = readRequiredString(params.milestoneId, 'milestoneId');
              const detail = moveProjectMilestone({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                milestoneId,
                direction: readDirection(params.direction),
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Moved milestone ${milestoneId} in @${projectId}.` }],
                details: {
                  action: 'move_milestone',
                  profile,
                  projectId,
                  milestoneCount: detail.project.plan.milestones.length,
                },
              };
            }

            case 'create_task': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const detail = createProjectTaskRecord({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                taskId: readOptionalString(params.taskId),
                title: readRequiredString(params.title, 'title'),
                status: readRequiredString(params.status, 'status'),
                milestoneId: params.milestoneId,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Created task in @${projectId}.` }],
                details: {
                  action: 'create_task',
                  profile,
                  projectId,
                  taskCount: detail.project.plan.tasks.length,
                },
              };
            }

            case 'update_task': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const taskId = readRequiredString(params.taskId, 'taskId');
              const detail = updateProjectTaskRecord({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                taskId,
                title: params.title,
                status: params.status,
                milestoneId: params.milestoneId,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Updated task ${taskId} in @${projectId}.` }],
                details: {
                  action: 'update_task',
                  profile,
                  projectId,
                  taskCount: detail.project.plan.tasks.length,
                },
              };
            }

            case 'delete_task': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const taskId = readRequiredString(params.taskId, 'taskId');
              const detail = deleteProjectTaskRecord({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                taskId,
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Deleted task ${taskId} from @${projectId}.` }],
                details: {
                  action: 'delete_task',
                  profile,
                  projectId,
                  taskCount: detail.project.plan.tasks.length,
                },
              };
            }

            case 'move_task': {
              const projectId = readRequiredString(params.projectId, 'projectId');
              const taskId = readRequiredString(params.taskId, 'taskId');
              const detail = moveProjectTaskRecord({
                repoRoot: options.repoRoot,
                profile,
                projectId,
                taskId,
                direction: readDirection(params.direction),
              });
              invalidateAppTopics('projects');
              return {
                content: [{ type: 'text' as const, text: `Moved task ${taskId} in @${projectId}.` }],
                details: {
                  action: 'move_task',
                  profile,
                  projectId,
                  taskCount: detail.project.plan.tasks.length,
                },
              };
            }

            default:
              throw new Error(`Unsupported project action: ${String(params.action)}`);
          }
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
            isError: true,
            details: { action: params.action },
          };
        }
      },
    });
  };
}
