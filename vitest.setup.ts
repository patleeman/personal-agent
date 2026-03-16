import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GLOBAL_KEY = '__PERSONAL_AGENT_VITEST_STATE_ROOT__' as const;

const globalForTestStateRoot = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: string;
};

if (!globalForTestStateRoot[GLOBAL_KEY]) {
  const stateRoot = mkdtempSync(join(tmpdir(), 'personal-agent-vitest-state-'));
  globalForTestStateRoot[GLOBAL_KEY] = stateRoot;

  process.once('exit', () => {
    rmSync(stateRoot, { recursive: true, force: true });
  });
}

if (!process.env.PERSONAL_AGENT_STATE_ROOT) {
  process.env.PERSONAL_AGENT_STATE_ROOT = globalForTestStateRoot[GLOBAL_KEY]!;
}
