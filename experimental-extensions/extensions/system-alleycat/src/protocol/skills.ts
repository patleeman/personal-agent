import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MethodHandler } from '../codexJsonRpcServer.js';

export const skills = {
  /**
   * `skills/list` — list available skills for the current cwd.
   */
  list: (async (params, _ctx) => {
    const p = params as Record<string, unknown> | undefined;
    const cwd = (p?.cwd as string) ?? process.cwd();

    const skillDirs = [join(cwd, '.personal-agent', 'skills'), join(cwd, '.pi', 'skills')];

    const result: Array<{ name: string; path: string; description?: string }> = [];

    for (const dir of skillDirs) {
      if (!existsSync(dir)) continue;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = join(dir, entry.name, 'SKILL.md');
        if (!existsSync(skillPath)) continue;
        result.push({
          name: entry.name,
          path: skillPath,
          description: readSkillDescription(skillPath),
        });
      }
    }

    return { data: result };
  }) as MethodHandler,
};

function readSkillDescription(skillPath: string): string | undefined {
  try {
    const content = readFileSync(skillPath, 'utf-8');
    const lines = content.split('\n').slice(0, 5);
    const desc = lines.find((l) => l.trim() && !l.startsWith('#'));
    return desc?.trim().slice(0, 200);
  } catch {
    return undefined;
  }
}
