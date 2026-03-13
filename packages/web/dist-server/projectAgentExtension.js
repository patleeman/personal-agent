import { Type } from '@sinclair/typebox';
import { addConversationProjectLink, getConversationProjectLink, projectExists, removeConversationProjectLink, } from '@personal-agent/core';
import { invalidateAppTopics } from './appEvents.js';
const PROJECT_ACTION_VALUES = [
    'reference',
    'unreference',
];
const ProjectToolParams = Type.Object({
    action: Type.Union(PROJECT_ACTION_VALUES.map((value) => Type.Literal(value))),
    projectId: Type.String({ description: 'Project id, for example web-ui.' }),
});
function readRequiredString(value, label) {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error(`${label} is required.`);
    }
    return normalized;
}
function formatConversationReferences(relatedProjectIds) {
    return relatedProjectIds.length > 0
        ? relatedProjectIds.map((projectId) => `@${projectId}`).join(', ')
        : 'none';
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
            description: 'Reference or unreference projects in the current conversation. Durable project edits are file-based and guided by the pa-project-hub skill.',
            promptSnippet: 'Use the project tool only to reference or unreference projects in the current conversation. For durable project edits, load the pa-project-hub skill and use file tools.',
            promptGuidelines: [
                'Use this tool only to reference or unreference projects in the current conversation.',
                'For durable project edits, load the pa-project-hub skill and use file tools on PROJECT.yaml, BRIEF.md, notes/, attachments/, and artifacts/.',
                'Do not use this tool to edit project fields, milestones, tasks, briefs, notes, or files.',
            ],
            parameters: ProjectToolParams,
            async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                try {
                    const profile = options.getCurrentProfile();
                    const conversationId = ctx.sessionManager.getSessionId();
                    const projectId = readRequiredString(params.projectId, 'projectId');
                    switch (params.action) {
                        case 'reference': {
                            if (!projectExists({ repoRoot: options.repoRoot, profile, projectId })) {
                                throw new Error(`Project not found: ${projectId}`);
                            }
                            const document = addConversationProjectLink({
                                stateRoot: options.stateRoot,
                                profile,
                                conversationId,
                                projectId,
                            });
                            invalidateAppTopics('projects', 'sessions');
                            return {
                                content: [{ type: 'text', text: `Referenced @${projectId} in this conversation.\nCurrent referenced projects: ${formatConversationReferences(document.relatedProjectIds)}` }],
                                details: { action: 'reference', projectId, relatedProjectIds: document.relatedProjectIds },
                            };
                        }
                        case 'unreference': {
                            const document = removeConversationProjectLink({
                                stateRoot: options.stateRoot,
                                profile,
                                conversationId,
                                projectId,
                            });
                            invalidateAppTopics('projects', 'sessions');
                            return {
                                content: [{ type: 'text', text: `Stopped referencing @${projectId} in this conversation.\nCurrent referenced projects: ${formatConversationReferences(document.relatedProjectIds)}` }],
                                details: { action: 'unreference', projectId, relatedProjectIds: document.relatedProjectIds },
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
