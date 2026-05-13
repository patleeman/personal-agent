#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, '..');
const runtimeDir = join(extensionRoot, 'bin', 'darwin-arm64');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`))));
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'personal-agent-llama-cpp-extension' } });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return response.json();
}

async function download(url, destination) {
  const response = await fetch(url, { headers: { 'user-agent': 'personal-agent-llama-cpp-extension' } });
  if (!response.ok || !response.body) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  await pipeline(response.body, createWriteStream(destination));
}

async function findFile(root, filename) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === filename) return path;
    if (entry.isDirectory()) {
      const found = await findFile(path, filename);
      if (found) return found;
    }
  }
  return null;
}

const release = await fetchJson('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest');
const asset = release.assets.find((candidate) => {
  const name = candidate.name.toLowerCase();
  return name.endsWith('.zip') && name.includes('macos') && name.includes('arm64');
});

if (!asset) throw new Error(`Could not find a macOS arm64 llama.cpp release asset in ${release.html_url}`);

await mkdir(runtimeDir, { recursive: true });
const workDir = await mkdtemp(join(tmpdir(), 'pa-llama-cpp-'));
const zipPath = join(workDir, asset.name);

try {
  console.log(`Downloading ${asset.name}`);
  await download(asset.browser_download_url, zipPath);
  await run('ditto', ['-x', '-k', zipPath, workDir]);

  for (const binary of ['llama-cli', 'llama-server']) {
    const source = await findFile(workDir, binary);
    if (!source) throw new Error(`Downloaded asset did not contain ${binary}`);
    const destination = join(runtimeDir, binary);
    await copyFile(source, destination);
    await chmod(destination, 0o755);
    console.log(`Installed ${destination}`);
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}

console.log('llama.cpp runtime installed.');
