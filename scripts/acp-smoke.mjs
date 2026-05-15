#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

function parseArgs(argv) {
  const args = { keepState: false, cwd: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--keep-state') args.keepState = true;
    else if (token === '--cwd' && argv[i + 1]) {
      args.cwd = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

class SmokeClient {
  constructor() {
    this.updates = [];
  }

  async sessionUpdate(params) {
    this.updates.push(params);
  }

  async requestPermission() {
    return { outcome: { outcome: 'cancelled' } };
  }

  async readTextFile() {
    return { content: '' };
  }

  async writeTextFile() {
    return {};
  }
}

async function makeStateRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pa-acp-smoke-'));
  await mkdir(path.join(root, 'extensions'), { recursive: true });
  await writeFile(
    path.join(root, 'extensions', 'registry.json'),
    `${JSON.stringify({ enabledIds: ['system-acp'], disabledIds: [] }, null, 2)}\n`,
  );
  return root;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stateRoot = await makeStateRoot();
  const cliPath = path.resolve('scripts/personal-agent-cli.mjs');

  const child = spawn('node', [cliPath, 'protocol', 'acp'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
      PERSONAL_AGENT_ACP_SMOKE_TEST: '1',
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const client = new SmokeClient();
  const connection = new acp.ClientSideConnection(
    () => client,
    acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  );

  try {
    const init = await connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: 'acp-smoke', version: '1.0.0' },
    });

    const session = await connection.newSession({
      cwd: args.cwd,
      mcpServers: [],
    });

    const prompt = await connection.prompt({
      sessionId: session.sessionId,
      messageId: crypto.randomUUID(),
      prompt: [{ type: 'text', text: 'Say hello from ACP smoke test.' }],
    });

    const list = await connection.listSessions({ cwd: args.cwd });
    const loaded = await connection.loadSession({ sessionId: session.sessionId, cwd: args.cwd, mcpServers: [] });
    const forked = await connection.unstable_forkSession({ sessionId: session.sessionId, cwd: args.cwd, mcpServers: [] });
    await connection.closeSession({ sessionId: session.sessionId });

    const updateKinds = [...new Set(client.updates.map((item) => item.update.sessionUpdate))];

    console.log(
      JSON.stringify(
        {
          ok: true,
          protocolVersion: init.protocolVersion,
          sessionId: session.sessionId,
          stopReason: prompt.stopReason,
          listedSessions: list.sessions.length,
          loadedSessionId: loaded.sessionId,
          forkedSessionId: forked.sessionId,
          updateKinds,
          stateRoot,
        },
        null,
        2,
      ),
    );
  } finally {
    child.kill();
    if (!args.keepState) {
      await rm(stateRoot, { recursive: true, force: true });
    }
  }
}

await main();
