import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

import {
  APPLY_PATCH_DESCRIPTION,
  APPLY_PATCH_PROMPT_GUIDELINES,
  APPLY_PATCH_PROMPT_SNIPPET,
  applyPatch,
  synchronizeActiveTools,
} from './applyPatch';

function syncToolSelection(pi: Pick<ExtensionAPI, 'getActiveTools' | 'setActiveTools'>, model: { id?: unknown } | null | undefined): void {
  const currentTools = pi.getActiveTools();
  const nextTools = synchronizeActiveTools(currentTools, model);
  if (nextTools.length !== currentTools.length || nextTools.some((toolName, index) => toolName !== currentTools[index])) {
    pi.setActiveTools(nextTools);
  }
}

export default function gptApplyPatchExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'apply_patch',
    label: 'apply_patch',
    description: APPLY_PATCH_DESCRIPTION,
    promptSnippet: APPLY_PATCH_PROMPT_SNIPPET,
    promptGuidelines: [...APPLY_PATCH_PROMPT_GUIDELINES],
    parameters: Type.Object({
      input: Type.String({ description: 'The entire contents of the apply_patch command' }),
    }),
    prepareArguments(args) {
      if (!args || typeof args !== 'object') {
        return args as { input: string };
      }

      const input = args as { input?: unknown; patch?: unknown };
      if (typeof input.input === 'string') {
        return { input: input.input };
      }
      if (typeof input.patch === 'string') {
        return { input: input.patch };
      }
      return args as { input: string };
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await applyPatch(params.input, ctx.cwd);
      return {
        content: [{ type: 'text' as const, text: result.summary }],
        details: {
          added: result.added,
          modified: result.modified,
          deleted: result.deleted,
        },
      };
    },
  });

  pi.on('session_start', (_event, ctx) => {
    syncToolSelection(pi, ctx.model);
  });

  pi.on('model_select', (event) => {
    syncToolSelection(pi, event.model);
  });

  pi.on('before_agent_start', (_event, ctx) => {
    syncToolSelection(pi, ctx.model);
  });
}

export { syncToolSelection };
