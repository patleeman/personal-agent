import type { MethodHandler } from '../server.js';

export const models = {
  /**
   * `model/list` — list available models.
   */
  list: (async (_params, ctx) => {
    try {
      const allModels = await ctx.models.list();
      return { data: allModels };
    } catch {
      return { data: [] };
    }
  }) as MethodHandler,
};
