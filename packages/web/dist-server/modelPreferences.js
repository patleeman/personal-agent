import { existsSync, readFileSync } from 'node:fs';
function readNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}
export function readSavedModelPreferences(settingsFile) {
    if (!existsSync(settingsFile)) {
        return { currentModel: '', currentThinkingLevel: '' };
    }
    try {
        const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8'));
        return {
            currentModel: readNonEmptyString(parsed.defaultModel),
            currentThinkingLevel: readNonEmptyString(parsed.defaultThinkingLevel),
        };
    }
    catch {
        return { currentModel: '', currentThinkingLevel: '' };
    }
}
