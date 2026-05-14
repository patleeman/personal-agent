#!/usr/bin/env node

import { writeFileSync } from 'node:fs';

import { AuthStorage, SessionManager } from '@earendil-works/pi-coding-agent';
import { getPiAgentRuntimeDir, getProfilesRoot, getStateRoot } from '@personal-agent/core';

import { createPreparedLiveAgentSession } from '../conversations/liveSessionFactory.js';
import { createManifestAgentExtensions } from '../extensions/extensionAgentExtensions.js';
import { createManifestToolAgentExtensions } from '../extensions/manifestToolAgentExtension.js';
import { buildLiveSessionResourceOptionsForRuntime } from '../extensions/runtimeAgentHooks.js';
import { readSavedModelPreferences } from '../models/modelPreferences.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE } from '../ui/settingsPersistence.js';

interface RunnerArgs {
  prompt: string;
  cwd: string;
  sessionDir?: string;
  continueSession?: boolean;
  noSession?: boolean;
  model?: string;
  allowedTools?: string[];
}

function readFlagValue(args: string[], index: number, label: string): string {
  const value = args[index + 1]?.trim();
  if (!value) {
    throw new Error(`${label} requires a value.`);
  }
  return value;
}

function parseArgs(argv: string[]): RunnerArgs {
  const parsed: Partial<RunnerArgs> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--prompt':
      case '-p':
        parsed.prompt = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--cwd':
        parsed.cwd = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--session-dir':
        parsed.sessionDir = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--continue':
        parsed.continueSession = true;
        break;
      case '--no-session':
        parsed.noSession = true;
        break;
      case '--model':
        parsed.model = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--tools': {
        const tools = readFlagValue(argv, index, arg)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        if (tools.length > 0) {
          parsed.allowedTools = tools;
        }
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown background agent runner argument: ${arg}`);
    }
  }

  if (!parsed.prompt?.trim()) {
    throw new Error('--prompt is required.');
  }

  return {
    prompt: parsed.prompt.trim(),
    cwd: parsed.cwd?.trim() || process.cwd(),
    ...(parsed.sessionDir?.trim() ? { sessionDir: parsed.sessionDir.trim() } : {}),
    ...(parsed.continueSession === true ? { continueSession: true } : {}),
    ...(parsed.noSession === true ? { noSession: true } : {}),
    ...(parsed.model?.trim() ? { model: parsed.model.trim() } : {}),
    ...(parsed.allowedTools && parsed.allowedTools.length > 0 ? { allowedTools: parsed.allowedTools } : {}),
  };
}

function writeRunnerResult(summary: string): void {
  const resultPath = process.env.PERSONAL_AGENT_RUN_RESULT_PATH?.trim();
  if (!resultPath) {
    return;
  }

  writeFileSync(resultPath, `${JSON.stringify({ version: 1, summary }, null, 2)}\n`, 'utf-8');
}

function readParentSessionFile(): string | undefined {
  const value = process.env.PERSONAL_AGENT_PARENT_SESSION_FILE?.trim();
  return value ? value : undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const agentDir = getPiAgentRuntimeDir();
  const resourceOptions = buildLiveSessionResourceOptionsForRuntime();
  const agentExtensions = createManifestAgentExtensions({
    onError: (message, fields) => console.warn(`[background-agent] ${message}`, fields ?? ''),
  });
  const extensionFactories = [
    ...createManifestToolAgentExtensions({
      getCurrentProfile: () => process.env.PERSONAL_AGENT_ACTIVE_PROFILE || process.env.PERSONAL_AGENT_PROFILE || 'shared',
      getPreferredVisionModel: () => readSavedModelPreferences(DEFAULT_RUNTIME_SETTINGS_FILE).currentVisionModel,
      hasOpenAiImageProvider: () => {
        try {
          const auth = AuthStorage.create(`${agentDir}/auth.json`);
          return auth.hasAuth('openai') || auth.hasAuth('openai-codex');
        } catch {
          return false;
        }
      },
      repoRoot: process.env.PERSONAL_AGENT_REPO_ROOT || process.cwd(),
      profilesRoot: getProfilesRoot(),
      stateRoot: getStateRoot(),
    }),
    ...agentExtensions.factories,
  ];

  const sessionManager = args.noSession
    ? SessionManager.inMemory(args.cwd)
    : args.continueSession && args.sessionDir
      ? SessionManager.continueRecent(args.cwd, args.sessionDir)
      : SessionManager.create(args.cwd, args.sessionDir);

  const parentSessionFile = args.noSession || args.continueSession ? undefined : readParentSessionFile();
  if (parentSessionFile) {
    sessionManager.newSession({ parentSession: parentSessionFile });
  }

  const { session } = await createPreparedLiveAgentSession({
    cwd: args.cwd,
    agentDir,
    settingsFile: DEFAULT_RUNTIME_SETTINGS_FILE,
    sessionManager,
    options: {
      ...resourceOptions,
      extensionFactories,
      ...(args.model ? { initialModel: args.model } : {}),
      ...(args.allowedTools ? { allowedToolNames: args.allowedTools } : {}),
    },
    applyInitialPreferences: true,
    ensureSessionFile: !args.noSession,
  });

  try {
    session.subscribe((event) => {
      if (event.type === 'message_update') {
        const update = event.assistantMessageEvent;
        if (update.type === 'text_delta') process.stdout.write(update.delta);
        if (update.type === 'thinking_delta') process.stdout.write(update.delta);
      }
    });

    await session.prompt(args.prompt);
    process.stdout.write('\n');
    writeRunnerResult('Background agent completed successfully.');
  } finally {
    session.dispose();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  writeRunnerResult(message);
  process.exitCode = 1;
});
