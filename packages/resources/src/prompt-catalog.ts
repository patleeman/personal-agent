import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as nunjucks from 'nunjucks';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export type PromptCatalogVariables = Record<string, string | number | boolean | null | undefined>;

function normalizePromptText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

export function getPromptCatalogRoot(explicitRepoRoot?: string): string {
  const repoRoot = resolve(explicitRepoRoot ?? process.env.PERSONAL_AGENT_REPO_ROOT ?? PACKAGE_ROOT);
  return join(repoRoot, 'prompt-catalog');
}

function resolvePromptCatalogPath(relativePath: string, explicitRepoRoot?: string): string {
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

export function readPromptCatalogEntry(relativePath: string, options: { repoRoot?: string } = {}): string | undefined {
  const path = resolvePromptCatalogPath(relativePath, options.repoRoot);
  if (!existsSync(path)) {
    return undefined;
  }

  return normalizePromptText(readFileSync(path, 'utf-8'));
}

export function requirePromptCatalogEntry(relativePath: string, options: { repoRoot?: string } = {}): string {
  const text = readPromptCatalogEntry(relativePath, options);
  if (typeof text !== 'string' || text.length === 0) {
    const root = getPromptCatalogRoot(options.repoRoot);
    throw new Error(`Prompt catalog entry not found: ${relativePath} (root: ${root})`);
  }

  return text;
}

export interface RenderPromptCatalogTemplateOptions {
  templateRoot?: string;
}

function normalizeTemplateVariables(variables: PromptCatalogVariables): Record<string, string | number | boolean> {
  const entries = Object.entries(variables).map(([key, value]) => {
    if (value === undefined || value === null || value === false) {
      return [key, ''];
    }

    return [key, value];
  });

  return Object.fromEntries(entries);
}

function getTemplateEnvironment(templateRoot?: string): nunjucks.Environment {
  const loader = templateRoot
    ? new nunjucks.FileSystemLoader(templateRoot, { noCache: true })
    : undefined;

  return new nunjucks.Environment(loader, {
    autoescape: false,
  });
}

export function renderPromptCatalogTemplate(
  template: string,
  variables: PromptCatalogVariables = {},
  options: RenderPromptCatalogTemplateOptions = {},
): string {
  const rendered = getTemplateEnvironment(options.templateRoot).renderString(
    template,
    normalizeTemplateVariables(variables),
  );

  return rendered
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function composePromptCatalogEntries(
  relativePaths: string[],
  options: { repoRoot?: string; separator?: string } = {},
): string {
  const parts = relativePaths.map((relativePath) => requirePromptCatalogEntry(relativePath, { repoRoot: options.repoRoot }));
  return parts.join(options.separator ?? '\n\n').trim();
}

export function listPromptCatalogEntries(relativeDir: string, options: { repoRoot?: string } = {}): string[] {
  const dirPath = resolvePromptCatalogPath(relativeDir, options.repoRoot);
  if (!existsSync(dirPath)) {
    return [];
  }

  return readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => `${relativeDir.replace(/\/$/, '')}/${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

export function composePromptCatalogDirectory(
  relativeDir: string,
  options: { repoRoot?: string; separator?: string } = {},
): string | undefined {
  if (relativeDir === 'system') {
    const singleTemplatePath = resolvePromptCatalogPath('system.md', options.repoRoot);
    if (existsSync(singleTemplatePath)) {
      const root = getPromptCatalogRoot(options.repoRoot);
      const singleTemplate = requirePromptCatalogEntry('system.md', { repoRoot: options.repoRoot });
      const rendered = renderPromptCatalogTemplate(singleTemplate, {}, { templateRoot: root });
      if (rendered.length > 0) {
        return rendered;
      }
    }
  }

  const entries = listPromptCatalogEntries(relativeDir, { repoRoot: options.repoRoot });
  if (entries.length === 0) {
    return undefined;
  }

  return composePromptCatalogEntries(entries, options);
}
