import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
function readNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}
function readSettingsObject(settingsFile) {
    if (!existsSync(settingsFile)) {
        return {};
    }
    try {
        const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        return { ...parsed };
    }
    catch {
        return {};
    }
}
function normalizeThemeMode(value) {
    if (value === 'light' || value === 'dark' || value === 'system') {
        return value;
    }
    return 'system';
}
export function readSavedThemePreferences(settingsFile) {
    const parsed = readSettingsObject(settingsFile);
    return {
        currentTheme: readNonEmptyString(parsed.theme),
        themeMode: normalizeThemeMode(parsed.themeMode),
        themeDark: readNonEmptyString(parsed.themeDark),
        themeLight: readNonEmptyString(parsed.themeLight),
    };
}
export function writeSavedThemePreferences(input, settingsFile) {
    const settings = readSettingsObject(settingsFile);
    if (input.themeMode !== undefined) {
        settings.themeMode = normalizeThemeMode(input.themeMode);
    }
    if (input.themeDark !== undefined) {
        const normalized = readNonEmptyString(input.themeDark ?? '');
        if (normalized) {
            settings.themeDark = normalized;
        }
        else {
            delete settings.themeDark;
        }
    }
    if (input.themeLight !== undefined) {
        const normalized = readNonEmptyString(input.themeLight ?? '');
        if (normalized) {
            settings.themeLight = normalized;
        }
        else {
            delete settings.themeLight;
        }
    }
    mkdirSync(dirname(settingsFile), { recursive: true });
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
    return readSavedThemePreferences(settingsFile);
}
