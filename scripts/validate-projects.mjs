#!/usr/bin/env node

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getProfilesRoot,
  listProjectIds,
  readProject,
  resolveProjectPaths,
} from '@personal-agent/core';

function printUsage() {
  console.log(`Usage:
  node scripts/validate-projects.mjs --profile <profile> [--project <projectId>] [--json]
  node scripts/validate-projects.mjs --all-profiles [--json]
  node scripts/validate-projects.mjs --path <path/to/PROJECT.yaml> [--json]

Options:
  --profile <profile>   Validate all projects in one profile, or one project with --project
  --project <projectId> Validate one project within --profile
  --all-profiles        Validate every project in every profile under the runtime profiles root
  --path <file>         Validate exactly one PROJECT.yaml file by path
  --json                Print machine-readable JSON output
  --help                Show this help text
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    profile: undefined,
    projectId: undefined,
    allProfiles: false,
    path: undefined,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--all-profiles') {
      options.allProfiles = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--profile') {
      const value = argv[index + 1];
      if (!value) {
        fail('Missing value for --profile');
      }
      options.profile = value;
      index += 1;
      continue;
    }

    if (arg === '--project') {
      const value = argv[index + 1];
      if (!value) {
        fail('Missing value for --project');
      }
      options.projectId = value;
      index += 1;
      continue;
    }

    if (arg === '--path') {
      const value = argv[index + 1];
      if (!value) {
        fail('Missing value for --path');
      }
      options.path = resolve(value);
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (options.path && (options.profile || options.projectId || options.allProfiles)) {
    fail('--path cannot be combined with --profile, --project, or --all-profiles');
  }

  if (options.allProfiles && (options.profile || options.projectId)) {
    fail('--all-profiles cannot be combined with --profile or --project');
  }

  if (options.projectId && !options.profile) {
    fail('--project requires --profile');
  }

  if (!options.path && !options.allProfiles && !options.profile) {
    fail('Choose one scope: --path, --profile, or --all-profiles');
  }

  return options;
}

function listProfiles() {
  const profilesRoot = getProfilesRoot();
  if (!existsSync(profilesRoot)) {
    return [];
  }

  return readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function buildTargets(options) {
  if (options.path) {
    return [
      {
        label: options.path,
        path: options.path,
        profile: null,
        expectedProjectId: null,
      },
    ];
  }

  const profiles = options.allProfiles ? listProfiles() : [options.profile];
  const targets = [];

  for (const profile of profiles) {
    const projectIds = options.projectId
      ? [options.projectId]
      : listProjectIds({ profile });

    for (const projectId of projectIds) {
      const paths = resolveProjectPaths({ profile, projectId });
      targets.push({
        label: `${profile}/${projectId}`,
        path: paths.projectFile,
        profile,
        expectedProjectId: projectId,
      });
    }
  }

  return targets;
}

function validateTarget(target) {
  if (!existsSync(target.path)) {
    return {
      ok: false,
      label: target.label,
      path: target.path,
      profile: target.profile,
      projectId: target.expectedProjectId,
      error: 'PROJECT.yaml not found.',
    };
  }

  try {
    const project = readProject(target.path);

    if (target.expectedProjectId && project.id !== target.expectedProjectId) {
      throw new Error(`Project id ${project.id} does not match expected project id ${target.expectedProjectId}.`);
    }

    return {
      ok: true,
      label: target.label,
      path: target.path,
      profile: target.profile,
      projectId: project.id,
      title: project.title,
    };
  } catch (error) {
    return {
      ok: false,
      label: target.label,
      path: target.path,
      profile: target.profile,
      projectId: target.expectedProjectId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function printTextReport(results) {
  if (results.length === 0) {
    console.log('No project files matched the requested scope.');
    return;
  }

  for (const result of results) {
    if (result.ok) {
      console.log(`OK   ${result.label}`);
      console.log(`     ${result.path}`);
    } else {
      console.log(`FAIL ${result.label}`);
      console.log(`     ${result.path}`);
      console.log(`     ${result.error}`);
    }
  }

  const failures = results.filter((result) => !result.ok).length;
  const successes = results.length - failures;
  console.log(`\nChecked ${results.length} project file(s): ${successes} passed, ${failures} failed.`);
}

const options = parseArgs(process.argv.slice(2));
const targets = buildTargets(options);
const results = targets.map(validateTarget);
const failures = results.filter((result) => !result.ok).length;

if (options.json) {
  console.log(JSON.stringify({
    ok: failures === 0,
    checked: results.length,
    failed: failures,
    results,
  }, null, 2));
} else {
  printTextReport(results);
}

process.exit(failures === 0 ? 0 : 1);
