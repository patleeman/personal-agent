import { Type } from '@sinclair/typebox';
import { addConversationProjectLink, getConversationProjectLink, listProjectIds, removeConversationProjectLink, resolveProjectPaths, } from '@personal-agent/core';
import { invalidateAppTopics } from './appEvents.js';
import { addProjectMilestone, createProjectRecord, createProjectTaskRecord, readProjectDetailFromProject, updateProjectMilestone, updateProjectRecord, updateProjectTaskRecord, } from './projects.js';
const PROJECT_ACTION_VALUES = [
    'list',
    'get',
    'create',
    'reference',
    'unreference',
    'update',
    'add_milestone',
    'update_milestone',
    'add_task',
    'update_task',
];
const ProjectToolParams = Type.Object({
    action: Type.Union(PROJECT_ACTION_VALUES.map((value) => Type.Literal(value))),
    projectId: Type.Optional(Type.String({ description: 'Project id, for example web-ui. Required for get/reference/unreference/update actions.' })),
    title: Type.Optional(Type.String({ description: 'Project, milestone, or task title depending on the action.' })),
    description: Type.Optional(Type.String({ description: 'Project description for create/update actions.' })),
    repoRoot: Type.Optional(Type.String({ description: 'Project repo root. Used as the conversation cwd when this project is the sole referenced project with a repo root and no explicit cwd is set.' })),
    summary: Type.Optional(Type.String({ description: 'Project or milestone summary text.' })),
    status: Type.Optional(Type.String({ description: 'Project status for create/update actions.' })),
    currentFocus: Type.Optional(Type.String({ description: 'Current focus for the project.' })),
    blockers: Type.Optional(Type.Array(Type.String({ description: 'Project blocker.' }))),
    recentProgress: Type.Optional(Type.Array(Type.String({ description: 'Recent progress item.' }))),
    currentMilestoneId: Type.Optional(Type.String({ description: 'Current milestone id for the project.' })),
    referenceInConversation: Type.Optional(Type.Boolean({ description: 'Whether to reference the project in the current conversation. Defaults to true for create.' })),
    milestoneId: Type.Optional(Type.String({ description: 'Milestone id for update_milestone actions.' })),
    milestoneStatus: Type.Optional(Type.String({ description: 'Milestone status.' })),
    makeCurrent: Type.Optional(Type.Boolean({ description: 'Set the milestone as the current milestone.' })),
    taskId: Type.Optional(Type.String({ description: 'Task id for update_task actions.' })),
    taskStatus: Type.Optional(Type.String({ description: 'Task status.' })),
    taskMilestoneId: Type.Optional(Type.String({ description: 'Milestone id to associate with the task. Defaults to the current milestone when omitted on add.' })),
});
function readRequiredString(value, label) {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error(`${label} is required.`);
    }
    return normalized;
}
function hasProjectMutation(params) {
    return params.title !== undefined
        || params.description !== undefined
        || params.repoRoot !== undefined
        || params.summary !== undefined
        || params.status !== undefined
        || params.currentFocus !== undefined
        || params.blockers !== undefined
        || params.recentProgress !== undefined
        || params.currentMilestoneId !== undefined;
}
function hasMilestoneMutation(params) {
    return params.title !== undefined
        || params.milestoneStatus !== undefined
        || params.summary !== undefined
        || params.makeCurrent !== undefined;
}
function hasTaskMutation(params) {
    return params.title !== undefined
        || params.taskStatus !== undefined
        || params.taskMilestoneId !== undefined;
}
function formatConversationReferences(relatedProjectIds) {
    return relatedProjectIds.length > 0
        ? relatedProjectIds.map((projectId) => `@${projectId}`).join(', ')
        : 'none';
}
function formatProjectList(details, relatedProjectIds) {
    if (details.length === 0) {
        return 'No projects found for the active profile.';
    }
    const lines = [
        `Referenced in this conversation: ${formatConversationReferences(relatedProjectIds)}`,
        '',
        'Projects:',
    ];
    for (const detail of details) {
        const description = detail.project.description.trim();
        const suffix = description.length > 0 ? ` — ${description}` : '';
        lines.push(`- ${detail.project.id} [${detail.project.status}] ${detail.project.title}${suffix}`);
    }
    return lines.join('\n');
}
function formatProjectDetail(detail, relatedProjectIds) {
    const currentMilestoneId = detail.project.plan.currentMilestoneId;
    const currentMilestone = currentMilestoneId
        ? detail.project.plan.milestones.find((milestone) => milestone.id === currentMilestoneId)
        : undefined;
    const lines = [
        `Project ${detail.project.id}`,
        `Title: ${detail.project.title}`,
        `Referenced in this conversation: ${formatConversationReferences(relatedProjectIds)}`,
        `Status: ${detail.project.status}`,
        `Description: ${detail.project.description}`,
        `Summary: ${detail.project.summary}`,
    ];
    if (detail.project.repoRoot) {
        lines.push(`Repo root: ${detail.project.repoRoot}`);
    }
    if (detail.project.currentFocus) {
        lines.push(`Current focus: ${detail.project.currentFocus}`);
    }
    if (currentMilestone) {
        lines.push(`Current milestone: ${currentMilestone.id} — ${currentMilestone.title} [${currentMilestone.status}]`);
    }
    if (detail.project.blockers.length > 0) {
        lines.push('Blockers:');
        for (const blocker of detail.project.blockers) {
            lines.push(`- ${blocker}`);
        }
    }
    if (detail.project.recentProgress.length > 0) {
        lines.push('Recent progress:');
        for (const item of detail.project.recentProgress) {
            lines.push(`- ${item}`);
        }
    }
    lines.push('Milestones:');
    for (const milestone of detail.project.plan.milestones) {
        const suffix = milestone.summary ? ` — ${milestone.summary}` : '';
        lines.push(`- ${milestone.id} [${milestone.status}] ${milestone.title}${suffix}`);
    }
    if (detail.tasks.length > 0) {
        lines.push('Tasks:');
        for (const task of detail.tasks) {
            const milestoneSuffix = task.milestoneId ? ` (milestone: ${task.milestoneId})` : '';
            lines.push(`- ${task.id} [${task.status}] ${task.title}${milestoneSuffix}`);
        }
    }
    else {
        lines.push('Tasks: none');
    }
    return lines.join('\n');
}
function getConversationProjectIds(profile, conversationId, stateRoot) {
    return getConversationProjectLink({
        stateRoot,
        profile,
        conversationId,
    })?.relatedProjectIds ?? [];
}
export function createProjectAgentExtension(options) {
    return (pi) => {
        pi.registerTool({
            name: 'project',
            label: 'Project',
            description: 'Create, reference, inspect, and update durable projects backed by PROJECT.yaml.',
            promptSnippet: 'Create, reference, inspect, and update durable projects and their milestones/tasks.',
            promptGuidelines: [
                'Use this tool when the user asks to create a project, inspect project state, or update milestones/tasks durably.',
                'Reference a project in the current conversation when it should stay in working context for later turns.',
                'Prefer the project tool over hand-editing PROJECT.yaml when you are managing structured project state.',
            ],
            parameters: ProjectToolParams,
            async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                try {
                    const profile = options.getCurrentProfile();
                    const conversationId = ctx.sessionManager.getSessionId();
                    const relatedProjectIds = getConversationProjectIds(profile, conversationId, options.stateRoot);
                    switch (params.action) {
                        case 'list': {
                            const details = listProjectIds({ repoRoot: options.repoRoot, profile })
                                .map((projectId) => readProjectDetailFromProject({ repoRoot: options.repoRoot, profile, projectId }));
                            return {
                                content: [{ type: 'text', text: formatProjectList(details, relatedProjectIds) }],
                                details: { action: 'list', projects: details.map((detail) => detail.project.id), relatedProjectIds },
                            };
                        }
                        case 'get': {
                            const projectId = readRequiredString(params.projectId, 'projectId');
                            const detail = readProjectDetailFromProject({ repoRoot: options.repoRoot, profile, projectId });
                            return {
                                content: [{ type: 'text', text: formatProjectDetail(detail, relatedProjectIds) }],
                                details: { action: 'get', projectId, relatedProjectIds },
                            };
                        }
                        case 'create': {
                            const detail = createProjectRecord({
                                repoRoot: options.repoRoot,
                                profile,
                                title: readRequiredString(params.title, 'title'),
                                description: readRequiredString(params.description, 'description'),
                                ...(params.repoRoot !== undefined ? { projectRepoRoot: params.repoRoot } : {}),
                                ...(params.summary !== undefined ? { summary: params.summary } : {}),
                                ...(params.status !== undefined ? { status: params.status } : {}),
                                ...(params.currentFocus !== undefined ? { currentFocus: params.currentFocus } : {}),
                                ...(params.blockers !== undefined ? { blockers: params.blockers } : {}),
                                ...(params.recentProgress !== undefined ? { recentProgress: params.recentProgress } : {}),
                            });
                            const createdProjectId = detail.project.id;
                            const shouldReference = params.referenceInConversation ?? true;
                            if (shouldReference) {
                                addConversationProjectLink({
                                    stateRoot: options.stateRoot,
                                    profile,
                                    conversationId,
                                    projectId: createdProjectId,
                                });
                            }
                            invalidateAppTopics('projects');
                            const nextRelatedProjectIds = shouldReference
                                ? getConversationProjectIds(profile, conversationId, options.stateRoot)
                                : relatedProjectIds;
                            return {
                                content: [{
                                        type: 'text',
                                        text: `${shouldReference ? `Created and referenced @${createdProjectId}.` : `Created project ${createdProjectId}.`}\n\n${formatProjectDetail(detail, nextRelatedProjectIds)}`,
                                    }],
                                details: { action: 'create', projectId: createdProjectId, referenced: shouldReference, relatedProjectIds: nextRelatedProjectIds },
                            };
                        }
                        case 'reference': {
                            const projectId = readRequiredString(params.projectId, 'projectId');
                            readProjectDetailFromProject({ repoRoot: options.repoRoot, profile, projectId });
                            const document = addConversationProjectLink({
                                stateRoot: options.stateRoot,
                                profile,
                                conversationId,
                                projectId,
                            });
                            return {
                                content: [{ type: 'text', text: `Referenced @${projectId} in this conversation.\nCurrent referenced projects: ${formatConversationReferences(document.relatedProjectIds)}` }],
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
                            return {
                                content: [{ type: 'text', text: `Stopped referencing @${projectId} in this conversation.\nCurrent referenced projects: ${formatConversationReferences(document.relatedProjectIds)}` }],
                                details: { action: 'unreference', projectId, relatedProjectIds: document.relatedProjectIds },
                            };
                        }
                        case 'update': {
                            if (!hasProjectMutation(params)) {
                                throw new Error('Provide at least one project field to update.');
                            }
                            const projectId = readRequiredString(params.projectId, 'projectId');
                            const detail = updateProjectRecord({
                                repoRoot: options.repoRoot,
                                profile,
                                projectId,
                                ...(params.title !== undefined ? { title: params.title } : {}),
                                ...(params.description !== undefined ? { description: params.description } : {}),
                                ...(params.repoRoot !== undefined ? { projectRepoRoot: params.repoRoot } : {}),
                                ...(params.summary !== undefined ? { summary: params.summary } : {}),
                                ...(params.status !== undefined ? { status: params.status } : {}),
                                ...(params.currentFocus !== undefined ? { currentFocus: params.currentFocus } : {}),
                                ...(params.blockers !== undefined ? { blockers: params.blockers } : {}),
                                ...(params.recentProgress !== undefined ? { recentProgress: params.recentProgress } : {}),
                                ...(params.currentMilestoneId !== undefined ? { currentMilestoneId: params.currentMilestoneId } : {}),
                            });
                            invalidateAppTopics('projects');
                            return {
                                content: [{ type: 'text', text: `Updated project ${projectId}.\n\n${formatProjectDetail(detail, relatedProjectIds)}` }],
                                details: { action: 'update', projectId },
                            };
                        }
                        case 'add_milestone': {
                            const projectId = readRequiredString(params.projectId, 'projectId');
                            const detail = addProjectMilestone({
                                repoRoot: options.repoRoot,
                                profile,
                                projectId,
                                title: readRequiredString(params.title, 'title'),
                                status: params.milestoneStatus?.trim() || 'pending',
                                ...(params.summary !== undefined ? { summary: params.summary } : {}),
                                ...(params.makeCurrent !== undefined ? { makeCurrent: params.makeCurrent } : {}),
                            });
                            invalidateAppTopics('projects');
                            return {
                                content: [{ type: 'text', text: `Added milestone to project ${projectId}.\n\n${formatProjectDetail(detail, relatedProjectIds)}` }],
                                details: { action: 'add_milestone', projectId },
                            };
                        }
                        case 'update_milestone': {
                            if (!hasMilestoneMutation(params)) {
                                throw new Error('Provide at least one milestone field to update.');
                            }
                            const projectId = readRequiredString(params.projectId, 'projectId');
                            const milestoneId = readRequiredString(params.milestoneId, 'milestoneId');
                            const detail = updateProjectMilestone({
                                repoRoot: options.repoRoot,
                                profile,
                                projectId,
                                milestoneId,
                                ...(params.title !== undefined ? { title: params.title } : {}),
                                ...(params.milestoneStatus !== undefined ? { status: params.milestoneStatus } : {}),
                                ...(params.summary !== undefined ? { summary: params.summary } : {}),
                                ...(params.makeCurrent !== undefined ? { makeCurrent: params.makeCurrent } : {}),
                            });
                            invalidateAppTopics('projects');
                            return {
                                content: [{ type: 'text', text: `Updated milestone ${milestoneId} in project ${projectId}.\n\n${formatProjectDetail(detail, relatedProjectIds)}` }],
                                details: { action: 'update_milestone', projectId, milestoneId },
                            };
                        }
                        case 'add_task': {
                            const projectId = readRequiredString(params.projectId, 'projectId');
                            const detail = createProjectTaskRecord({
                                repoRoot: options.repoRoot,
                                profile,
                                projectId,
                                title: readRequiredString(params.title, 'title'),
                                status: params.taskStatus?.trim() || 'pending',
                                ...(params.taskMilestoneId !== undefined ? { milestoneId: params.taskMilestoneId } : {}),
                            });
                            invalidateAppTopics('projects');
                            return {
                                content: [{ type: 'text', text: `Added task to project ${projectId}.\n\n${formatProjectDetail(detail, relatedProjectIds)}` }],
                                details: { action: 'add_task', projectId },
                            };
                        }
                        case 'update_task': {
                            if (!hasTaskMutation(params)) {
                                throw new Error('Provide at least one task field to update.');
                            }
                            const projectId = readRequiredString(params.projectId, 'projectId');
                            const taskId = readRequiredString(params.taskId, 'taskId');
                            const detail = updateProjectTaskRecord({
                                repoRoot: options.repoRoot,
                                profile,
                                projectId,
                                taskId,
                                ...(params.title !== undefined ? { title: params.title } : {}),
                                ...(params.taskStatus !== undefined ? { status: params.taskStatus } : {}),
                                ...(params.taskMilestoneId !== undefined ? { milestoneId: params.taskMilestoneId } : {}),
                            });
                            invalidateAppTopics('projects');
                            return {
                                content: [{ type: 'text', text: `Updated task ${taskId} in project ${projectId}.\n\n${formatProjectDetail(detail, relatedProjectIds)}` }],
                                details: { action: 'update_task', projectId, taskId },
                            };
                        }
                        default:
                            throw new Error(`Unsupported project action: ${params.action}`);
                    }
                }
                catch (error) {
                    return {
                        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
                        isError: true,
                        details: { action: params.action },
                    };
                }
            },
        });
    };
}
export function describeProjectFileLayout(repoRoot, profile, projectId) {
    const paths = resolveProjectPaths({ repoRoot, profile, projectId });
    return paths.projectFile;
}
