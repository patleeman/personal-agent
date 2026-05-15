import { hostname } from 'node:os';

import type { MethodHandler } from '../codexJsonRpcServer.js';

function defaultCwd(ctx: Parameters<MethodHandler>[1]): string {
  return ctx.runtime?.getRepoRoot?.() || process.env.PERSONAL_AGENT_REPO_ROOT || process.cwd();
}

export const config = {
  /**
   * `config/read` — read the effective configuration.
   * Keep the shape Codex clients expect: { config, origins, layers? }.
   */
  read: (async (params, ctx) => {
    const p = params as Record<string, unknown> | undefined;
    const cwd = typeof p?.cwd === 'string' && p.cwd.trim() && p.cwd !== '/root' ? p.cwd.trim() : defaultCwd(ctx);
    return {
      config: {
        cwd,
        default_cwd: cwd,
        model_provider: 'personal-agent',
        sandbox: 'danger-full-access',
        approval_policy: 'on-failure',
        platform: process.platform,
        hostname: hostname(),
        version: '0.1.0',
      },
      origins: {},
      layers: p?.includeLayers === true || p?.include_layers === true ? [] : undefined,
    };
  }) as MethodHandler,
};
