import { existsSync, readFileSync } from 'node:fs';
import { completeSimple } from '@mariozechner/pi-ai';
const DEFAULT_PROVIDER = 'openai-codex';
const DEFAULT_MODEL = 'gpt-5.1-codex-mini';
const DEFAULT_REASONING = 'minimal';
const DEFAULT_MAX_MESSAGES = 8;
const DEFAULT_MAX_TITLE_LENGTH = 80;
const DEFAULT_MAX_MESSAGE_LENGTH = 1_200;
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
function readBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
function readPositiveInteger(value, fallback) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
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
function readWebUiSettings(settings) {
    return isRecord(settings.webUi) ? { ...settings.webUi } : {};
}
function readConversationTitleSettingsObject(settings) {
    const webUi = readWebUiSettings(settings);
    return isRecord(webUi.conversationTitles) ? { ...webUi.conversationTitles } : {};
}
function readDefaultModelSettings(settings) {
    return {
        provider: readNonEmptyString(settings.defaultProvider),
        model: readNonEmptyString(settings.defaultModel),
    };
}
export function readConversationAutoTitleSettings(settingsFile) {
    const settings = readSettingsObject(settingsFile);
    const conversationTitles = readConversationTitleSettingsObject(settings);
    const defaultModelSettings = readDefaultModelSettings(settings);
    const configuredModel = readNonEmptyString(conversationTitles.model);
    const slashMatches = configuredModel.match(/\//g) ?? [];
    const slashIndex = configuredModel.indexOf('/');
    const providerFromModel = slashMatches.length === 1 && slashIndex > 0 && slashIndex < configuredModel.length - 1
        ? configuredModel.slice(0, slashIndex)
        : '';
    const modelId = providerFromModel ? configuredModel.slice(slashIndex + 1) : configuredModel;
    return {
        enabled: readBoolean(conversationTitles.enabled, true),
        provider: readNonEmptyString(conversationTitles.provider) || providerFromModel || defaultModelSettings.provider || DEFAULT_PROVIDER,
        model: modelId || defaultModelSettings.model || DEFAULT_MODEL,
        reasoning: normalizeThinkingLevel(conversationTitles.reasoning),
        maxMessages: readPositiveInteger(conversationTitles.maxMessages, DEFAULT_MAX_MESSAGES),
        maxTitleLength: readPositiveInteger(conversationTitles.maxTitleLength, DEFAULT_MAX_TITLE_LENGTH),
    };
}
function normalizeContent(content) {
    if (Array.isArray(content)) {
        return content;
    }
    if (typeof content === 'string' && content.length > 0) {
        return [{ type: 'text', text: content }];
    }
    return [];
}
function normalizeWhitespace(text) {
    return text.replace(/\s+/g, ' ').trim();
}
function truncateText(text, maxLength) {
    const normalized = normalizeWhitespace(text);
    if (normalized.length <= maxLength) {
        return normalized;
    }
    const slice = normalized.slice(0, maxLength).trim();
    const lastSpace = slice.lastIndexOf(' ');
    return lastSpace > Math.floor(maxLength / 2) ? slice.slice(0, lastSpace).trim() : slice;
}
function summarizeUserMessage(content) {
    const blocks = normalizeContent(content);
    const text = blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n')
        .trim();
    const imageCount = blocks.filter((block) => block.type === 'image').length;
    const attachmentLabel = imageCount === 1
        ? '(image attachment)'
        : imageCount > 1
            ? `(${imageCount} image attachments)`
            : '';
    if (text && attachmentLabel) {
        return normalizeWhitespace(`${text} ${attachmentLabel}`);
    }
    if (text) {
        return normalizeWhitespace(text);
    }
    return attachmentLabel;
}
function summarizeAssistantMessage(content) {
    const blocks = normalizeContent(content);
    return normalizeWhitespace(blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n'));
}
export function collectConversationTitleSourceMessages(messages, maxMessages = DEFAULT_MAX_MESSAGES) {
    const collected = [];
    for (const message of messages) {
        if (message.role === 'user') {
            const text = summarizeUserMessage(message.content);
            if (text) {
                collected.push({ role: 'user', text });
            }
            continue;
        }
        if (message.role === 'assistant') {
            const text = summarizeAssistantMessage(message.content);
            if (text) {
                collected.push({ role: 'assistant', text });
            }
        }
    }
    if (maxMessages > 0 && collected.length > maxMessages) {
        return collected.slice(-maxMessages);
    }
    return collected;
}
export function hasAssistantTitleSourceMessage(messages) {
    return collectConversationTitleSourceMessages(messages).some((message) => message.role === 'assistant');
}
export function buildConversationTitleTranscript(messages, options = {}) {
    const sourceMessages = collectConversationTitleSourceMessages(messages, options.maxMessages ?? DEFAULT_MAX_MESSAGES);
    if (!sourceMessages.some((message) => message.role === 'user') || !sourceMessages.some((message) => message.role === 'assistant')) {
        return '';
    }
    const maxMessageLength = options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH;
    return sourceMessages
        .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${truncateText(message.text, maxMessageLength)}`)
        .join('\n');
}
function extractAssistantText(content) {
    if (!Array.isArray(content)) {
        return typeof content === 'string' ? content : '';
    }
    return content
        .filter((block) => Boolean(block) && typeof block === 'object' && block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n');
}
function readCompletionError(response) {
    if (!isRecord(response) || response.stopReason !== 'error') {
        return null;
    }
    const errorMessage = readNonEmptyString(response.errorMessage);
    return errorMessage || 'Conversation title generation failed.';
}
export function normalizeGeneratedConversationTitle(title, maxLength = DEFAULT_MAX_TITLE_LENGTH) {
    if (typeof title !== 'string') {
        return null;
    }
    const firstLine = title
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0);
    if (!firstLine) {
        return null;
    }
    const normalized = normalizeWhitespace(firstLine
        .replace(/^title\s*:\s*/i, '')
        .replace(/^[-*•#]+\s*/, '')
        .replace(/^['"`]+/, '')
        .replace(/['"`]+$/, ''));
    if (!normalized) {
        return null;
    }
    return truncateText(normalized, maxLength);
}
function resolveConversationTitleModel(modelRegistry, settings) {
    const availableModels = modelRegistry.getAvailable();
    return availableModels.find((model) => model.provider === settings.provider && model.id === settings.model) ?? null;
}
export async function generateConversationTitle(options) {
    const settings = options.settings ?? readConversationAutoTitleSettings(options.settingsFile ?? '');
    if (!settings.enabled) {
        return null;
    }
    const transcript = buildConversationTitleTranscript(options.messages, { maxMessages: settings.maxMessages });
    if (!transcript) {
        return null;
    }
    const model = resolveConversationTitleModel(options.modelRegistry, settings);
    if (!model) {
        return null;
    }
    const response = await completeSimple(model, {
        systemPrompt: 'You write concise, specific titles for assistant conversations. Focus on the concrete task or outcome. Return only the title with no quotes or markdown.',
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: [
                            'Write a short title for this conversation.',
                            'Keep it specific and under 80 characters.',
                            'Return only the title.',
                            '',
                            transcript,
                        ].join('\n'),
                    },
                ],
                timestamp: options.now ?? Date.now(),
            },
        ],
    }, {
        apiKey: await options.modelRegistry.getApiKey(model),
        reasoning: settings.reasoning,
        maxTokens: 32,
        cacheRetention: 'none',
    });
    const errorMessage = readCompletionError(response);
    if (errorMessage) {
        throw new Error(errorMessage);
    }
    return normalizeGeneratedConversationTitle(extractAssistantText(response.content), settings.maxTitleLength);
}
