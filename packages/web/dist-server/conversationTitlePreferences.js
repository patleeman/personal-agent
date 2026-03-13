import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readConversationAutoTitleSettings } from './conversationAutoTitle.js';
function readNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}
function readBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
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
function readWebUiSettings(settings) {
    return isRecord(settings.webUi) ? { ...settings.webUi } : {};
}
function readConversationTitleSettingsObject(settings) {
    const webUi = readWebUiSettings(settings);
    return isRecord(webUi.conversationTitles) ? { ...webUi.conversationTitles } : {};
}
function normalizeConversationTitleModel(value, provider) {
    const model = readNonEmptyString(value);
    if (!model) {
        return '';
    }
    if (model.includes('/')) {
        return model;
    }
    const normalizedProvider = readNonEmptyString(provider);
    return normalizedProvider ? `${normalizedProvider}/${model}` : model;
}
function formatEffectiveModel(settingsFile) {
    const settings = readConversationAutoTitleSettings(settingsFile);
    return `${settings.provider}/${settings.model}`;
}
export function readSavedConversationTitlePreferences(settingsFile) {
    const settings = readSettingsObject(settingsFile);
    const conversationTitles = readConversationTitleSettingsObject(settings);
    return {
        enabled: readBoolean(conversationTitles.enabled, true),
        currentModel: normalizeConversationTitleModel(conversationTitles.model, conversationTitles.provider),
        effectiveModel: formatEffectiveModel(settingsFile),
    };
}
export function writeSavedConversationTitlePreferences(input, settingsFile) {
    const settings = readSettingsObject(settingsFile);
    const webUi = readWebUiSettings(settings);
    const conversationTitles = readConversationTitleSettingsObject(settings);
    if (input.enabled !== undefined) {
        if (input.enabled) {
            delete conversationTitles.enabled;
        }
        else {
            conversationTitles.enabled = false;
        }
    }
    if (input.model !== undefined) {
        const normalizedModel = readNonEmptyString(input.model ?? '');
        if (normalizedModel) {
            conversationTitles.model = normalizedModel;
            delete conversationTitles.provider;
        }
        else {
            delete conversationTitles.model;
            delete conversationTitles.provider;
        }
    }
    if (Object.keys(conversationTitles).length > 0) {
        webUi.conversationTitles = conversationTitles;
    }
    else {
        delete webUi.conversationTitles;
    }
    if (Object.keys(webUi).length > 0) {
        settings.webUi = webUi;
    }
    else {
        delete settings.webUi;
    }
    mkdirSync(dirname(settingsFile), { recursive: true });
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
    return readSavedConversationTitlePreferences(settingsFile);
}
