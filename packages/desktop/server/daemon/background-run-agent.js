import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function looksLikePersonalAgentCliEntryPath(value) {
    if (!value) {
        return false;
    }
    const normalized = value.replace(/\\/g, '/').toLowerCase();
    return normalized.endsWith('/cli/dist/index.js') || normalized.endsWith('/packages/cli/dist/index.js');
}
function resolveBackgroundAgentCliEntryPath() {
    const daemonModulePath = fileURLToPath(import.meta.url);
    const candidate = resolve(dirname(daemonModulePath), '../../cli/dist/index.js');
    return existsSync(candidate) ? candidate : undefined;
}
export function buildBackgroundAgentArgv(spec) {
    const cliEntryPath = resolveBackgroundAgentCliEntryPath();
    const argv = cliEntryPath ? [process.execPath, cliEntryPath, '--plain', 'tui'] : ['pa', '--plain', 'tui'];
    argv.push('--');
    if (spec.noSession === true) {
        argv.push('--no-session');
    }
    if (spec.model) {
        argv.push('--model', spec.model);
    }
    if (spec.allowedTools && spec.allowedTools.length > 0) {
        argv.push('--tools', spec.allowedTools.join(','));
    }
    argv.push('-p', spec.prompt);
    return argv;
}
