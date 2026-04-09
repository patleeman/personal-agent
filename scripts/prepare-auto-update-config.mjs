#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

const repoRoot = process.cwd();
const outputPath = resolve(repoRoot, 'build', 'generated', 'auto-update-config.json');
const defaultBaseUrl = 'https://personal-agent-download-gate.patricklee.workers.dev/updates/stable';
const defaultTokenPath = resolve(homedir(), '.config', 'personal-agent', 'personal-agent-download-token.txt');

function trimNonEmpty(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function loadDownloadToken() {
  const fromEnv = trimNonEmpty(process.env.PERSONAL_AGENT_DOWNLOAD_TOKEN);
  if (fromEnv) {
    return { token: fromEnv, source: 'PERSONAL_AGENT_DOWNLOAD_TOKEN' };
  }

  const tokenPath = resolve(process.env.PERSONAL_AGENT_DOWNLOAD_TOKEN_FILE ?? defaultTokenPath);
  if (!existsSync(tokenPath)) {
    return { token: null, source: tokenPath };
  }

  return {
    token: trimNonEmpty(readFileSync(tokenPath, 'utf-8')),
    source: tokenPath,
  };
}

const baseUrl = trimNonEmpty(process.env.PERSONAL_AGENT_UPDATE_BASE_URL) ?? defaultBaseUrl;
const { token, source } = loadDownloadToken();
const config = {
  url: baseUrl,
  token,
};

mkdirSync(dirname(outputPath), { recursive: true, mode: 0o755 });
writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');

if (token) {
  console.log(`Prepared protected desktop update config at ${outputPath} using token from ${source}`);
} else {
  console.warn(`Prepared desktop update config at ${outputPath} without a download token. Packaged builds from this machine will have auto-update disabled until PERSONAL_AGENT_DOWNLOAD_TOKEN or ${source} is available.`);
}
