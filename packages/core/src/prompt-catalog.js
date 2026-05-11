import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as nunjucks from 'nunjucks';
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
function normalizePromptText(text) {
    return text.replace(/\r\n/g, '\n').trim();
}
export function getPromptCatalogRoot(explicitRepoRoot) {
    const repoRoot = resolve(explicitRepoRoot ?? process.env.PERSONAL_AGENT_REPO_ROOT ?? PACKAGE_ROOT);
    return join(repoRoot, 'prompt-catalog');
}
function resolvePromptCatalogPath(relativePath, explicitRepoRoot) {
    if (!relativePath || relativePath.trim().length === 0) {
        throw new Error('Prompt catalog path must not be empty');
    }
    if (isAbsolute(relativePath)) {
        throw new Error(`Prompt catalog path must be relative: ${relativePath}`);
    }
    const root = getPromptCatalogRoot(explicitRepoRoot);
    const resolvedPath = resolve(root, relativePath);
    if (resolvedPath === root || !resolvedPath.startsWith(`${root}${sep}`)) {
        throw new Error(`Prompt catalog path is outside ${root}: ${relativePath}`);
    }
    return resolvedPath;
}
export function readPromptCatalogEntry(relativePath, options = {}) {
    const path = resolvePromptCatalogPath(relativePath, options.repoRoot);
    if (!existsSync(path)) {
        return undefined;
    }
    return normalizePromptText(readFileSync(path, 'utf-8'));
}
export function requirePromptCatalogEntry(relativePath, options = {}) {
    const text = readPromptCatalogEntry(relativePath, options);
    if (typeof text !== 'string' || text.length === 0) {
        const root = getPromptCatalogRoot(options.repoRoot);
        throw new Error(`Prompt catalog entry not found: ${relativePath} (root: ${root})`);
    }
    return text;
}
function normalizeTemplateVariables(variables) {
    const entries = Object.entries(variables).map(([key, value]) => {
        if (value === undefined || value === null || value === false) {
            return [key, ''];
        }
        return [key, value];
    });
    return Object.fromEntries(entries);
}
function getTemplateEnvironment(templateRoot) {
    const loader = templateRoot ? new nunjucks.FileSystemLoader(templateRoot, { noCache: true }) : undefined;
    return new nunjucks.Environment(loader, {
        autoescape: false,
    });
}
export function renderPromptCatalogTemplate(template, variables = {}, options = {}) {
    const rendered = getTemplateEnvironment(options.templateRoot).renderString(template, normalizeTemplateVariables(variables));
    return rendered
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
