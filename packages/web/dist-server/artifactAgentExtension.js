import { Type } from '@sinclair/typebox';
import { deleteConversationArtifact, getConversationArtifact, listConversationArtifacts, saveConversationArtifact, } from '@personal-agent/core';
import { invalidateAppTopics } from './appEvents.js';
const ARTIFACT_ACTION_VALUES = ['save', 'get', 'list', 'delete'];
const ARTIFACT_KIND_VALUES = ['html', 'mermaid', 'latex'];
const ArtifactToolParams = Type.Object({
    action: Type.Union(ARTIFACT_ACTION_VALUES.map((value) => Type.Literal(value))),
    artifactId: Type.Optional(Type.String({ description: 'Stable artifact id. Reuse this when updating an existing artifact.' })),
    kind: Type.Optional(Type.Union(ARTIFACT_KIND_VALUES.map((value) => Type.Literal(value)))),
    title: Type.Optional(Type.String({ description: 'Artifact title shown in the chat stub and artifact panel.' })),
    content: Type.Optional(Type.String({ description: 'Artifact source content. HTML should be self-contained. Mermaid should be raw source. LaTeX should be raw source, including full LaTeX documents when needed.' })),
    open: Type.Optional(Type.Boolean({ description: 'Whether the artifact panel should open after saving. Defaults to true.' })),
});
function readRequiredString(value, label) {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error(`${label} is required.`);
    }
    return normalized;
}
function readRequiredKind(kind) {
    const normalized = readRequiredString(kind, 'kind');
    if (!ARTIFACT_KIND_VALUES.includes(normalized)) {
        throw new Error(`Invalid artifact kind \"${normalized}\".`);
    }
    return normalized;
}
function formatArtifactList(conversationId, artifacts) {
    if (artifacts.length === 0) {
        return `No artifacts saved for conversation ${conversationId}.`;
    }
    return [
        `Artifacts for conversation ${conversationId}:`,
        ...artifacts.map((artifact) => `- ${artifact.id} [${artifact.kind}] ${artifact.title} (rev ${artifact.revision}, updated ${artifact.updatedAt})`),
    ].join('\n');
}
function formatArtifact(record) {
    return [
        `Artifact ${record.id}`,
        `Title: ${record.title}`,
        `Kind: ${record.kind}`,
        `Revision: ${record.revision}`,
        `Updated: ${record.updatedAt}`,
        '',
        record.content,
    ].join('\n');
}
export function createArtifactAgentExtension(options) {
    return (pi) => {
        pi.registerTool({
            name: 'artifact',
            label: 'Artifact',
            description: 'Create, update, inspect, and delete rendered conversation artifacts for the web UI.',
            promptSnippet: 'Create or update rendered HTML, Mermaid, and LaTeX artifacts for the artifact panel.',
            promptGuidelines: [
                'Use this tool when the user asks for a rendered artifact in the web UI rather than a plain chat response.',
                'Use kind=html for self-contained interactive artifacts, kind=mermaid for diagrams, and kind=latex for raw LaTeX source, including full document-style reports when appropriate.',
                'Reuse the same artifactId when iterating on an existing artifact so the chat stub and artifact panel stay linked.',
                'Keep HTML self-contained; do not rely on external network resources unless the user explicitly asks for that tradeoff.',
            ],
            parameters: ArtifactToolParams,
            async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                try {
                    const profile = options.getCurrentProfile();
                    const conversationId = ctx.sessionManager.getSessionId();
                    switch (params.action) {
                        case 'save': {
                            const record = saveConversationArtifact({
                                stateRoot: options.stateRoot,
                                profile,
                                conversationId,
                                ...(params.artifactId !== undefined ? { artifactId: params.artifactId } : {}),
                                title: readRequiredString(params.title, 'title'),
                                kind: readRequiredKind(params.kind),
                                content: params.content ?? '',
                            });
                            const openRequested = params.open ?? true;
                            invalidateAppTopics('sessions');
                            return {
                                content: [{
                                        type: 'text',
                                        text: `${record.revision === 1 ? 'Saved' : 'Updated'} artifact ${record.id} [${record.kind}] \"${record.title}\".`,
                                    }],
                                details: {
                                    action: 'save',
                                    conversationId,
                                    artifactId: record.id,
                                    title: record.title,
                                    kind: record.kind,
                                    revision: record.revision,
                                    updatedAt: record.updatedAt,
                                    openRequested,
                                },
                            };
                        }
                        case 'get': {
                            const artifactId = readRequiredString(params.artifactId, 'artifactId');
                            const record = getConversationArtifact({
                                stateRoot: options.stateRoot,
                                profile,
                                conversationId,
                                artifactId,
                            });
                            if (!record) {
                                throw new Error(`Artifact ${artifactId} was not found.`);
                            }
                            return {
                                content: [{ type: 'text', text: formatArtifact(record) }],
                                details: {
                                    action: 'get',
                                    conversationId,
                                    artifactId: record.id,
                                    title: record.title,
                                    kind: record.kind,
                                    revision: record.revision,
                                    updatedAt: record.updatedAt,
                                },
                            };
                        }
                        case 'list': {
                            const artifacts = listConversationArtifacts({
                                stateRoot: options.stateRoot,
                                profile,
                                conversationId,
                            });
                            return {
                                content: [{ type: 'text', text: formatArtifactList(conversationId, artifacts) }],
                                details: {
                                    action: 'list',
                                    conversationId,
                                    artifactCount: artifacts.length,
                                    artifactIds: artifacts.map((artifact) => artifact.id),
                                },
                            };
                        }
                        case 'delete': {
                            const artifactId = readRequiredString(params.artifactId, 'artifactId');
                            const removed = deleteConversationArtifact({
                                stateRoot: options.stateRoot,
                                profile,
                                conversationId,
                                artifactId,
                            });
                            invalidateAppTopics('sessions');
                            return {
                                content: [{
                                        type: 'text',
                                        text: removed
                                            ? `Deleted artifact ${artifactId}.`
                                            : `Artifact ${artifactId} did not exist.`,
                                    }],
                                details: {
                                    action: 'delete',
                                    conversationId,
                                    artifactId,
                                    deleted: removed,
                                },
                            };
                        }
                        default:
                            throw new Error(`Unsupported artifact action: ${String(params.action)}`);
                    }
                }
                catch (error) {
                    throw error instanceof Error ? error : new Error(String(error));
                }
            },
        });
    };
}
