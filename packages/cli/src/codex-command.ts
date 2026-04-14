import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getRepoRoot } from '@personal-agent/resources';

interface CodexServerModule {
  startCodexAppServer(input: { listenUrl: string }): Promise<{ websocketUrl: string; close(): Promise<void> }>;
}

function resolveCodexServerModuleUrl(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(getRepoRoot(), 'packages', 'web', 'dist-server', 'codex-app-server.js'),
    resolve(currentDir, '..', '..', 'web', 'dist-server', 'codex-app-server.js'),
    resolve(process.cwd(), 'packages', 'web', 'dist-server', 'codex-app-server.js'),
  ];

  for (const filePath of candidates) {
    if (existsSync(filePath)) {
      return pathToFileURL(filePath).href;
    }
  }

  throw new Error(`Could not resolve Codex app-server module. Tried: ${candidates.join(', ')}`);
}

async function loadCodexServerModule(): Promise<CodexServerModule> {
  return import(resolveCodexServerModuleUrl()) as Promise<CodexServerModule>;
}

function readOption(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }

  return typeof args[index + 1] === 'string' ? args[index + 1] as string : '';
}

export async function codexCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    console.log('Usage: pa codex app-server [--listen ws://127.0.0.1:8390]');
    return 0;
  }

  if (subcommand !== 'app-server') {
    throw new Error(`Unsupported pa codex subcommand: ${subcommand}`);
  }

  const listen = readOption(rest, '--listen') || 'ws://127.0.0.1:8390';
  const module = await loadCodexServerModule();
  const handle = await module.startCodexAppServer({ listenUrl: listen });
  console.log(`personal-agent codex app-server listening on ${handle.websocketUrl}`);

  await new Promise<void>((resolve, reject) => {
    let closing = false;
    const shutdown = async () => {
      if (closing) {
        return;
      }
      closing = true;
      try {
        await handle.close();
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    process.once('SIGINT', () => {
      void shutdown();
    });
    process.once('SIGTERM', () => {
      void shutdown();
    });
  });

  return 0;
}
