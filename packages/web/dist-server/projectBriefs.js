import { existsSync, readFileSync } from 'node:fs';
import { completeSimple } from '@mariozechner/pi-ai';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
const DEFAULT_PROVIDER = 'openai-codex';
const DEFAULT_MODEL = 'gpt-5.1-codex-mini';
const DEFAULT_REASONING = 'minimal';
const DEFAULT_MAX_ITEMS = 8;
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function readSettingsObject(settingsFile) {
    if (!existsSync(settingsFile)) {
        return {};
    }
    try {
        const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8'));
        return isRecord(parsed) ? { ...parsed } : {};
    }
    catch {
        return {};
    }
}
function readNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}
function normalizeThinkingLevel(value) {
    switch (value) {
        case 'minimal':
        case 'low':
        case 'medium':
        case 'high':
        case 'xhigh':
            return value;
        default:
            return DEFAULT_REASONING;
    }
}
function readProjectBriefSettings(settingsFile) {
    const settings = readSettingsObject(settingsFile);
    const configuredModel = readNonEmptyString(settings.defaultModel);
    const configuredProvider = readNonEmptyString(settings.defaultProvider);
    const configuredThinkingLevel = normalizeThinkingLevel(settings.defaultThinkingLevel);
    return {
        provider: configuredProvider || DEFAULT_PROVIDER,
        model: configuredModel || DEFAULT_MODEL,
        reasoning: configuredThinkingLevel,
    };
}
function makeModelRegistry(authFile) {
    return new ModelRegistry(AuthStorage.create(authFile));
}
function resolveModel(modelRegistry, settings) {
    return modelRegistry.getAvailable().find((model) => model.provider === settings.provider && model.id === settings.model) ?? null;
}
function truncate(value, maxLength = 280) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
function formatList(lines, fallback) {
    return lines.length > 0 ? lines.join('\n') : fallback;
}
function buildProjectDigest(detail, linkedConversations, activityEntries) {
    const project = detail.project;
    const milestoneLines = project.plan.milestones.slice(0, DEFAULT_MAX_ITEMS).map((milestone) => (`- ${milestone.title} [${milestone.status}]${milestone.summary ? ` — ${truncate(milestone.summary, 160)}` : ''}`));
    const taskLines = detail.tasks.slice(0, DEFAULT_MAX_ITEMS).map((task) => (`- ${task.title} [${task.status}]${task.milestoneId ? ` (milestone: ${task.milestoneId})` : ' (unassigned)'}`));
    const noteLines = detail.notes.slice(0, DEFAULT_MAX_ITEMS).map((note) => (`- ${note.title} [${note.kind}] — ${truncate(note.body, 180) || 'No body.'}`));
    const attachmentLines = detail.attachments.slice(0, DEFAULT_MAX_ITEMS).map((file) => (`- ${file.title} (${file.originalName}, ${file.sizeBytes} bytes)${file.description ? ` — ${truncate(file.description, 140)}` : ''}`));
    const artifactLines = detail.artifacts.slice(0, DEFAULT_MAX_ITEMS).map((file) => (`- ${file.title} (${file.originalName}, ${file.sizeBytes} bytes)${file.description ? ` — ${truncate(file.description, 140)}` : ''}`));
    const conversationLines = linkedConversations.slice(0, DEFAULT_MAX_ITEMS).map((conversation) => (`- ${conversation.title} (${conversation.conversationId})${conversation.lastActivityAt ? ` — last activity ${conversation.lastActivityAt}` : ''}${conversation.snippet ? ` — ${truncate(conversation.snippet, 180)}` : ''}`));
    const activityLines = activityEntries.slice(0, DEFAULT_MAX_ITEMS).map((entry) => (`- ${entry.summary}${entry.details ? ` — ${truncate(entry.details, 180)}` : ''}`));
    return [
        `Project ID: ${project.id}`,
        `Title: ${project.title}`,
        `Status: ${project.status}`,
        `Description: ${project.description}`,
        `Summary: ${project.summary}`,
        project.currentFocus ? `Current focus: ${project.currentFocus}` : 'Current focus: none',
        project.repoRoot ? `Repo root: ${project.repoRoot}` : 'Repo root: none',
        '',
        'Blockers:',
        formatList(project.blockers.map((blocker) => `- ${blocker}`), '- none'),
        '',
        'Recent progress:',
        formatList(project.recentProgress.map((item) => `- ${item}`), '- none'),
        '',
        'Milestones:',
        formatList(milestoneLines, '- none'),
        '',
        'Tasks:',
        formatList(taskLines, '- none'),
        '',
        'Existing brief:',
        detail.brief ? truncate(detail.brief.content, 2_000) : 'No project brief exists yet.',
        '',
        'Recent notes:',
        formatList(noteLines, '- none'),
        '',
        'Attachments:',
        formatList(attachmentLines, '- none'),
        '',
        'Artifacts:',
        formatList(artifactLines, '- none'),
        '',
        'Linked conversations:',
        formatList(conversationLines, '- none'),
        '',
        'Recent related activity:',
        formatList(activityLines, '- none'),
    ].join('\n');
}
function extractAssistantText(content) {
    return content
        .filter((item) => item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text?.trim() ?? '')
        .filter((text) => text.length > 0)
        .join('\n\n')
        .trim();
}
export async function generateProjectBrief(options) {
    const settings = readProjectBriefSettings(options.settingsFile);
    const modelRegistry = makeModelRegistry(options.authFile);
    const model = resolveModel(modelRegistry, settings);
    if (!model) {
        throw new Error(`Project brief model not found: ${settings.provider}/${settings.model}`);
    }
    const response = await completeSimple(model, {
        systemPrompt: [
            'You write high-signal project briefs for an engineering assistant.',
            'Return markdown only with no code fences.',
            'Write a durable brief that helps future conversations pick up the work quickly.',
            'Use concise sections and include only facts supported by the provided project context.',
        ].join(' '),
        messages: [
            {
                role: 'user',
                timestamp: Date.now(),
                content: [{
                        type: 'text',
                        text: [
                            'Regenerate the canonical project brief for this project.',
                            'Use exactly these sections in markdown:',
                            '# Project brief',
                            '## What this project is',
                            '## Current state',
                            '## Open work',
                            '## Important context',
                            '## Recommended next step',
                            '',
                            'Keep the writing compact, concrete, and useful for future conversations.',
                            'Do not mention that the brief was generated.',
                            '',
                            buildProjectDigest(options.detail, options.linkedConversations, options.activityEntries),
                        ].join('\n'),
                    }],
            },
        ],
    }, {
        apiKey: await modelRegistry.getApiKey(model),
        reasoning: settings.reasoning,
        temperature: 0.2,
        maxTokens: 900,
        cacheRetention: 'none',
    });
    const text = extractAssistantText(response.content);
    if (!text) {
        throw new Error('Project brief generation returned no text.');
    }
    return text.trim();
}
