#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const headingPattern = /^##\s+/mu;

export function formatReleaseSection(version, date, entries) {
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new Error('Version must be a non-empty string.');
  }
  if (typeof date !== 'string' || date.trim().length === 0) {
    throw new Error('Release date must be a non-empty string.');
  }

  const normalizedEntries = entries.map((entry) => entry.trim()).filter(Boolean);
  const renderedEntries = normalizedEntries.length > 0 ? normalizedEntries : ['Release maintenance'];

  return [`## ${version.trim()} — ${date.trim()}`, '', ...renderedEntries.map((entry) => `- ${entry}`), ''].join('\n');
}

export function applyChangelogRelease(content, version, date, entries) {
  const trimmedVersion = version.trim();
  const existingHeading = new RegExp(`^##\\s+v?${trimmedVersion.replaceAll('.', '\\.')}(?:\\s|$)`, 'mu');
  if (existingHeading.test(content)) {
    return { changed: false, content };
  }

  const section = formatReleaseSection(trimmedVersion, date, entries);
  const firstHeadingMatch = headingPattern.exec(content);
  if (!firstHeadingMatch) {
    const nextContent = `${content.trimEnd()}\n\n${section}`;
    return { changed: nextContent !== content, content: nextContent };
  }

  const insertIndex = firstHeadingMatch.index;
  const prefix = content.slice(0, insertIndex).trimEnd();
  const suffix = content.slice(insertIndex).trimStart();
  const nextContent = `${prefix}\n\n${section}\n${suffix}`;
  return { changed: nextContent !== content, content: nextContent };
}

function capture(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function getReleaseEntries() {
  let range = 'HEAD';
  try {
    const previousTag = capture('git', ['describe', '--tags', '--abbrev=0']);
    if (previousTag) {
      range = `${previousTag}..HEAD`;
    }
  } catch {
    // No previous tag; use all reachable commits.
  }

  try {
    return capture('git', ['log', range, '--pretty=format:%s'])
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^v?\d+\.\d+\.\d+$/u.test(line));
  } catch {
    return [];
  }
}

export function updateChangelogForRelease(repoRoot) {
  const packageJsonPath = resolve(repoRoot, 'package.json');
  const changelogPath = resolve(repoRoot, 'CHANGELOG.md');

  if (!existsSync(changelogPath)) {
    throw new Error('CHANGELOG.md does not exist.');
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (typeof packageJson.version !== 'string' || packageJson.version.trim().length === 0) {
    throw new Error('Root package.json is missing a version string.');
  }

  const date = new Date().toISOString().slice(0, 10);
  const currentContent = readFileSync(changelogPath, 'utf8');
  const result = applyChangelogRelease(currentContent, packageJson.version, date, getReleaseEntries());

  if (!result.changed) {
    console.log(`CHANGELOG.md already contains ${packageJson.version}.`);
    return result;
  }

  writeFileSync(changelogPath, result.content);
  console.log(`Updated CHANGELOG.md for ${packageJson.version}.`);
  return result;
}

function isDirectExecution() {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }

  return import.meta.url === pathToFileURL(resolve(entrypoint)).href;
}

if (isDirectExecution()) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  updateChangelogForRelease(resolve(scriptDir, '..'));
}
