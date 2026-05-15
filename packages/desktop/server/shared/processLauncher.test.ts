import { describe, expect, it } from 'vitest';

import { execFileProcess } from './processLauncher.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('processLauncher', () => {
  it('terminates shell command descendants on abort', async () => {
    const controller = new AbortController();
    const marker = `pa-process-abort-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const run = execFileProcess({
      command: 'sh',
      args: ['-lc', `node -e "process.title='${marker}'; setInterval(()=>{}, 1000)"`],
      signal: controller.signal,
    });

    await sleep(250);
    controller.abort();
    await expect(run).rejects.toThrow(/aborted/i);
    await sleep(250);

    const ps = await execFileProcess({ command: 'sh', args: ['-lc', `ps -axo command | grep ${marker} | grep -v grep || true`] });
    expect(ps.stdout.trim()).toBe('');
  });
});
