import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type PromptCatalogVariables = Record<string, string | number | boolean | null | undefined>;

function normalizePromptText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function inferRepoRootFromExtension(importMetaUrl: string): string {
  let current = resolve(dirname(fileURLToPath(importMetaUrl)));

  while (true) {
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

export function renderPromptCatalogTemplate(template: string, variables: PromptCatalogVariables = {}): string {
  const rendered = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null || value === false) {
      return '';
    }

    return String(value);
  });

  return rendered
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
