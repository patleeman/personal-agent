import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSavedModelPreferences } from './modelPreferences.js';
const tempDirs = [];
afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function createTempDir() {
    const dir = mkdtempSync(join(tmpdir(), 'pa-web-model-prefs-'));
    tempDirs.push(dir);
    return dir;
}
describe('readSavedModelPreferences', () => {
    it('returns empty values when the settings file is missing', () => {
        const dir = createTempDir();
        expect(readSavedModelPreferences(join(dir, 'settings.json'))).toEqual({ currentModel: '', currentThinkingLevel: '' });
    });
    it('reads the default model and thinking level from settings.json', () => {
        const dir = createTempDir();
        const file = join(dir, 'settings.json');
        writeFileSync(file, JSON.stringify({ defaultModel: 'gpt-5.4', defaultThinkingLevel: 'xhigh' }));
        expect(readSavedModelPreferences(file)).toEqual({ currentModel: 'gpt-5.4', currentThinkingLevel: 'xhigh' });
    });
    it('falls back safely on invalid JSON', () => {
        const dir = createTempDir();
        const file = join(dir, 'settings.json');
        writeFileSync(file, '{not json');
        expect(readSavedModelPreferences(file)).toEqual({ currentModel: '', currentThinkingLevel: '' });
    });
});
