import { existsSync, readFileSync } from 'node:fs';
import * as nunjucks from 'nunjucks';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type PromptCatalogVariables = Record<string, string | number | boolean | null | undefined>;

function normalizePromptText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function normalizePromptVariables(variables: PromptCatalogVariables): Record<string, string | number | boolean> {
  const entries = Object.entries(variables).map(([key, value]) => {
    if (value === undefined || value === null || value === false) {
      return [key, ''];
    }

    return [key, value];
  });

  return Object.fromEntries(entries);
}

function getTemplateRootFromExtension(importMetaUrl: string): string {
  const catalogRoot = inferRepoRootFromExtension(importMetaUrl);
  return resolve(catalogRoot, 'prompt-catalog');
}

function getTemplateEnvironment(importMetaUrl: string): nunjucks.Environment {
  return new nunjucks.Environment(new nunjucks.FileSystemLoader(getTemplateRootFromExtension(importMetaUrl), {
    noCache: true,
  }), {
    autoescape: false,
  });
}

function getTemplateEnvironmentWithoutLoader(): nunjucks.Environment {
  return new nunjucks.Environment(undefined, { autoescape: false });
}

function inferRepoRootFromExtension(importMetaUrl: string): string {
  let current = resolve(dirname(fileURLToPath(importMetaUrl)));

  for (;;) {
    if (existsSync(join(current, 'prompt-catalog'))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }

    current = parent;
  }

  return resolve(dirname(fileURLToPath(importMetaUrl)), '../..');
}

export function resolveRepoRootFromExtension(importMetaUrl: string): string {
  const explicit = process.env.PERSONAL_AGENT_REPO_ROOT?.trim();
  if (explicit && explicit.length > 0) {
    return resolve(explicit);
  }

  return inferRepoRootFromExtension(importMetaUrl);
}

function resolvePromptCatalogPath(root: string, relativePath: string): string {
  if (!relativePath || relativePath.trim().length === 0) {
    throw new Error('Prompt catalog path must not be empty');
  }

  if (isAbsolute(relativePath)) {
    throw new Error(`Prompt catalog path must be relative: ${relativePath}`);
  }

  const resolvedPath = resolve(root, relativePath);

  if (resolvedPath === root || !resolvedPath.startsWith(`${root}${sep}`)) {
    throw new Error(`Prompt catalog path is outside ${root}: ${relativePath}`);
  }

  return resolvedPath;
}

function getPromptCatalogRoots(importMetaUrl: string): string[] {
  const explicitRepoRoot = process.env.PERSONAL_AGENT_REPO_ROOT?.trim();
  const inferredRepoRoot = inferRepoRootFromExtension(importMetaUrl);
  const roots = [
    explicitRepoRoot ? join(resolve(explicitRepoRoot), 'prompt-catalog') : undefined,
    join(inferredRepoRoot, 'prompt-catalog'),
  ].filter((value, index, values): value is string => typeof value === 'string' && value.length > 0 && values.indexOf(value) === index);

  return roots;
}

export function readPromptCatalogEntryFromExtension(importMetaUrl: string, relativePath: string): string | undefined {
  for (const root of getPromptCatalogRoots(importMetaUrl)) {
    const path = resolvePromptCatalogPath(root, relativePath);
    if (existsSync(path)) {
      return normalizePromptText(readFileSync(path, 'utf-8'));
    }
  }

  return undefined;
}

export function requirePromptCatalogEntryFromExtension(importMetaUrl: string, relativePath: string): string {
  const text = readPromptCatalogEntryFromExtension(importMetaUrl, relativePath);
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error(`Prompt catalog entry not found: ${relativePath} (roots: ${getPromptCatalogRoots(importMetaUrl).join(', ')})`);
  }

  return text;
}

export function renderPromptCatalogTemplate(template: string, variables: PromptCatalogVariables = {}, importMetaUrl?: string): string {
  const env = importMetaUrl
    ? getTemplateEnvironment(importMetaUrl)
    : getTemplateEnvironmentWithoutLoader();

  const rendered = env.renderString(template, normalizePromptVariables(variables));

  return rendered
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
