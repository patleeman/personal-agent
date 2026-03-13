import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { persistSettingsWrite, resolveLocalProfileSettingsFilePath } from './settingsPersistence.js';
const tempDirs = [];
afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function createTempDir(prefix = 'pa-web-settings-persist-') {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}
describe('resolveLocalProfileSettingsFilePath', () => {
    it('uses <local>/agent/settings.json when the nested agent dir exists', () => {
        const localDir = createTempDir();
        mkdirSync(join(localDir, 'agent'), { recursive: true });
        expect(resolveLocalProfileSettingsFilePath(localDir)).toBe(join(localDir, 'agent', 'settings.json'));
    });
    it('falls back to <local>/settings.json when local dir exists without nested agent dir', () => {
        const localDir = createTempDir();
        expect(resolveLocalProfileSettingsFilePath(localDir)).toBe(join(localDir, 'settings.json'));
    });
    it('throws when local path exists but is not a directory', () => {
        const localDir = createTempDir();
        const file = join(localDir, 'local-file');
        writeFileSync(file, '{}\n');
        expect(() => resolveLocalProfileSettingsFilePath(file)).toThrow(`Local profile path is not a directory: ${file}`);
    });
});
describe('persistSettingsWrite', () => {
    it('writes to local settings before runtime settings and returns runtime result', () => {
        const writes = [];
        const result = persistSettingsWrite((settingsFile) => {
            writes.push(settingsFile);
            return settingsFile;
        }, {
            localSettingsFile: '/tmp/local-settings.json',
            runtimeSettingsFile: '/tmp/runtime-settings.json',
        });
        expect(writes).toEqual(['/tmp/local-settings.json', '/tmp/runtime-settings.json']);
        expect(result).toBe('/tmp/runtime-settings.json');
    });
    it('does not attempt runtime write when local write fails', () => {
        const writes = [];
        expect(() => persistSettingsWrite((settingsFile) => {
            writes.push(settingsFile);
            if (settingsFile.includes('local')) {
                throw new Error('local write failed');
            }
            return settingsFile;
        }, {
            localSettingsFile: '/tmp/local-settings.json',
            runtimeSettingsFile: '/tmp/runtime-settings.json',
        })).toThrow('local write failed');
        expect(writes).toEqual(['/tmp/local-settings.json']);
    });
});
