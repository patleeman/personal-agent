import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getConfigRoot } from '@personal-agent/core';
function readNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}
export function getProfileConfigFilePath() {
    const explicit = process.env.PERSONAL_AGENT_CONFIG_FILE;
    if (explicit && explicit.trim().length > 0) {
        return explicit;
    }
    return join(getConfigRoot(), 'config.json');
}
export function readSavedProfilePreferences(configFile = getProfileConfigFilePath()) {
    if (!existsSync(configFile)) {
        return { defaultProfile: 'shared' };
    }
    try {
        const parsed = JSON.parse(readFileSync(configFile, 'utf-8'));
        return {
            defaultProfile: readNonEmptyString(parsed.defaultProfile) || 'shared',
        };
    }
    catch {
        return { defaultProfile: 'shared' };
    }
}
export function writeSavedProfilePreferences(profile, configFile = getProfileConfigFilePath()) {
    mkdirSync(dirname(configFile), { recursive: true });
    writeFileSync(configFile, JSON.stringify({ defaultProfile: profile }, null, 2) + '\n');
}
export function resolveActiveProfile(input) {
    const candidates = [
        readNonEmptyString(input.explicitProfile),
        readNonEmptyString(input.savedProfile),
        'shared',
    ].filter((value) => value.length > 0);
    for (const candidate of candidates) {
        if (input.availableProfiles.includes(candidate)) {
            return candidate;
        }
    }
    return input.availableProfiles[0] ?? 'shared';
}
