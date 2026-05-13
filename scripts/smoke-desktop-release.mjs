#!/usr/bin/env node
/* eslint-env node */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const appPath = process.argv[2] ? resolve(process.argv[2]) : '';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function allocatePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a loopback port.');
  }
  return address.port;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function waitForPageTarget(port, child, logs, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`App exited during smoke test with code ${child.exitCode}.\n${logs()}`);
    }

    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) {
        return page;
      }
      lastError = 'CDP responded but no page target was available yet.';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for desktop app CDP page target: ${lastError}\n${logs()}`);
}

function connectCdp(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (!message.id || !pending.has(message.id)) {
      return;
    }

    const { resolve: resolvePending, reject } = pending.get(message.id);
    pending.delete(message.id);

    if (message.error) {
      reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      return;
    }

    resolvePending(message.result);
  });

  const opened = new Promise((resolveOpen, rejectOpen) => {
    ws.once('open', resolveOpen);
    ws.once('error', rejectOpen);
  });

  return {
    async send(method, params = {}) {
      await opened;
      const id = nextId;
      nextId += 1;
      const promise = new Promise((resolveCommand, rejectCommand) => {
        pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
      });
      ws.send(JSON.stringify({ id, method, params }));
      return promise;
    },
    close() {
      ws.close();
    },
  };
}

async function waitForLoadedBody(cdp, child, logs, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastBody = '';

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`App exited while waiting for ${label}.\n${logs()}`);
    }

    const result = await cdp.send('Runtime.evaluate', {
      expression: 'document.body ? document.body.innerText : ""',
      returnByValue: true,
    });
    const body = String(result?.result?.value ?? '').trim();
    lastBody = body;

    if (
      body.length > 0 &&
      !/startup error|open logs\s+try again|could not load|was compiled against a different node\.js version/i.test(body)
    ) {
      return body;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${label} to render. Last body text:\n${lastBody}\n\n${logs()}`);
}

async function navigateAndAssert(cdp, child, logs, url, label) {
  await cdp.send('Page.navigate', { url });
  await waitForLoadedBody(cdp, child, logs, label);
}

async function assertDesktopApiEndpoints(cdp, child, logs) {
  if (child.exitCode !== null) {
    throw new Error(`App exited before desktop API smoke checks.\n${logs()}`);
  }

  const endpoints = [
    '/api/extensions/installed',
    '/api/extensions/routes',
    '/api/extensions/surfaces',
    '/api/gateways',
    '/api/extensions/keybindings',
    '/api/extensions',
    '/api/extensions/slash-commands',
    '/api/extensions/mentions',
    '/api/models',
  ];
  const expression = `
    (async () => {
      const endpoints = ${JSON.stringify(endpoints)};
      return Promise.all(endpoints.map(async (path) => {
        try {
          const response = await fetch(path);
          const body = await response.text();
          return { path, status: response.status, ok: response.ok, body: body.slice(0, 500) };
        } catch (error) {
          return { path, status: 0, ok: false, body: error instanceof Error ? error.message : String(error) };
        }
      }));
    })()
  `;

  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const checks = result?.result?.value;
  if (!Array.isArray(checks)) {
    throw new Error(`Desktop API smoke checks returned an unexpected result: ${JSON.stringify(result)}\n${logs()}`);
  }

  const failures = checks.filter((check) => !check?.ok);
  if (failures.length > 0) {
    throw new Error(
      [`Packaged desktop API smoke checks failed:`, ...failures.map((check) => `${check.path} -> ${check.status}: ${check.body}`), logs()]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

async function assertLiveSessionBash(cdp, child, logs, cwd) {
  if (child.exitCode !== null) {
    throw new Error(`App exited before live session bash smoke check.\n${logs()}`);
  }

  const expression = `
    (async () => {
      const get = async (path) => {
        const response = await fetch(path);
        return { status: response.status, ok: response.ok, body: await response.text() };
      };
      const post = async (path, body) => {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        return { status: response.status, ok: response.ok, body: await response.text() };
      };
      const del = async (path) => {
        const response = await fetch(path, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ surfaceId: 'release-smoke' }),
        });
        return { status: response.status, ok: response.ok, body: await response.text() };
      };

      const models = await get('/api/models');
      let model = 'gpt-5.4';
      try {
        model = JSON.parse(models.body).currentModel || model;
      } catch {}

      const created = await post('/api/live-sessions', { cwd: ${JSON.stringify(cwd)}, model, thinkingLevel: 'medium' });
      let sessionId = '';
      try {
        sessionId = JSON.parse(created.body).id || '';
      } catch {}

      const bash = sessionId
        ? await post('/api/live-sessions/' + encodeURIComponent(sessionId) + '/bash', { command: 'printf pa-bash-ok' })
        : { status: 0, ok: false, body: 'no live session id returned' };
      const closed = sessionId ? await del('/api/live-sessions/' + encodeURIComponent(sessionId)) : null;
      return { models, model, created, bash, closed };
    })()
  `;

  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const value = result?.result?.value;
  const bashBody = typeof value?.bash?.body === 'string' ? value.bash.body : '';
  if (!value?.created?.ok || !value?.bash?.ok || !bashBody.includes('pa-bash-ok')) {
    throw new Error(`Packaged live session bash smoke check failed: ${JSON.stringify(value, null, 2)}\n${logs()}`);
  }
}

function tail(value, max = 8_000) {
  return value.length > max ? value.slice(value.length - max) : value;
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assertPackagedAgentReadableResources(appBundlePath) {
  const resourcesPath = join(appBundlePath, 'Contents', 'Resources');
  const requiredResources = ['docs/index.md', 'extensions/system-settings/README.md', 'extensions/system-runs/skills/runs/SKILL.md'];
  const missing = requiredResources.filter((relativePath) => !existsSync(join(resourcesPath, relativePath)));

  const extensionsRoot = join(resourcesPath, 'extensions');
  if (existsSync(extensionsRoot)) {
    for (const entry of readdirSync(extensionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(extensionsRoot, entry.name, 'extension.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = readJsonFile(manifestPath);
      for (const builtEntry of [manifest.frontend?.entry, ...(manifest.frontend?.styles ?? []), manifest.backend?.entry]) {
        if (typeof builtEntry === 'string' && builtEntry.trim().length > 0 && !existsSync(join(extensionsRoot, entry.name, builtEntry))) {
          missing.push(`extensions/${entry.name}/${builtEntry}`);
        }
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Packaged app is missing agent-readable resources:\n${missing.map((path) => `- ${path}`).join('\n')}`);
  }
}

async function main() {
  if (!appPath) {
    fail('Usage: node scripts/smoke-desktop-release.mjs <path-to-Personal Agent.app>');
  }

  assertPackagedAgentReadableResources(appPath);

  const executablePath = join(appPath, 'Contents', 'MacOS', basename(appPath, '.app'));
  const tempRoot = mkdtempSync(join(tmpdir(), 'pa-release-smoke-'));
  const stateRoot = join(tempRoot, 'state');
  const daemonSocketPath = join(tempRoot, 'daemon.sock');
  const debugPort = await allocatePort();
  const companionPort = await allocatePort();
  const stdoutChunks = [];
  const stderrChunks = [];
  const renderLogs = () =>
    [
      stdoutChunks.length ? `stdout:\n${tail(stdoutChunks.join(''))}` : '',
      stderrChunks.length ? `stderr:\n${tail(stderrChunks.join(''))}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

  const child = spawn(executablePath, [`--remote-debugging-port=${debugPort}`, '--no-quit-confirmation'], {
    env: {
      ...process.env,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
      PERSONAL_AGENT_DAEMON_SOCKET_PATH: daemonSocketPath,
      PERSONAL_AGENT_COMPANION_PORT: String(companionPort),
      PERSONAL_AGENT_DESKTOP_SKIP_QUIT_CONFIRMATION: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => stdoutChunks.push(String(chunk)));
  child.stderr.on('data', (chunk) => stderrChunks.push(String(chunk)));

  let cdp;
  try {
    const page = await waitForPageTarget(debugPort, child, renderLogs);
    cdp = connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    await waitForLoadedBody(cdp, child, renderLogs, 'initial desktop route');
    await assertDesktopApiEndpoints(cdp, child, renderLogs);
    await navigateAndAssert(cdp, child, renderLogs, 'personal-agent://app/knowledge', 'Knowledge route');
    await assertDesktopApiEndpoints(cdp, child, renderLogs);
    await navigateAndAssert(cdp, child, renderLogs, 'personal-agent://app/', 'conversation route');
    await assertDesktopApiEndpoints(cdp, child, renderLogs);
    await assertLiveSessionBash(cdp, child, renderLogs, process.cwd());

    console.log(`Release desktop smoke test passed with isolated state root: ${stateRoot}`);
  } finally {
    cdp?.close();
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await sleep(1_000);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }

    const preserve = ['1', 'true', 'yes'].includes(
      String(process.env.PERSONAL_AGENT_RELEASE_PRESERVE_SMOKE_STATE ?? '')
        .trim()
        .toLowerCase(),
    );
    if (!preserve) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
