import { StringEnum } from '@mariozechner/pi-ai';
import { defineTool, type ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { join } from 'node:path';
import { resolveRepoRootFromExtension } from '../_shared/prompt-catalog.js';
import {
  executeComputerUse,
  prepareComputerUseArguments,
  reconstructStateFromBranch,
  stopComputerUseHelper,
} from './runtime.js';

const internalSkillPath = join(resolveRepoRootFromExtension(import.meta.url), 'internal-skills', 'computer-use', 'INDEX.md');

const computerUseTool = defineTool({
  name: 'computer_use',
  label: 'Computer Use',
  description: 'Operate a visible macOS app window by observing it, clicking, moving, dragging, scrolling, typing, pressing keys, or waiting.',
  promptSnippet: 'Operate a visible macOS app window through a screenshot-and-action loop when shell/file tools are not enough.',
  promptGuidelines: [
    `When the task requires interacting with a visible macOS app window, read the built-in computer-use internal skill at ${internalSkillPath} before using this tool.`,
    'Use action="observe" first to choose or refresh the current target window.',
    'All coordinates are window-relative screenshot pixels from the latest observe result.',
    'Successful actions return a fresh screenshot and updated captureId for the next step.',
  ],
  executionMode: 'sequential',
  prepareArguments: prepareComputerUseArguments,
  parameters: Type.Object({
    action: StringEnum([
      'observe',
      'click',
      'double_click',
      'move',
      'drag',
      'scroll',
      'type',
      'keypress',
      'wait',
    ] as const),
    app: Type.Optional(Type.String({ description: 'For action="observe", optional app name to target, for example Safari or TextEdit.' })),
    windowTitle: Type.Optional(Type.String({ description: 'For action="observe", optional window title filter.' })),
    x: Type.Optional(Type.Number({ description: 'Window-relative X coordinate in the latest screenshot.' })),
    y: Type.Optional(Type.Number({ description: 'Window-relative Y coordinate in the latest screenshot.' })),
    button: Type.Optional(StringEnum(['left', 'right', 'wheel', 'back', 'forward'] as const)),
    path: Type.Optional(Type.Array(Type.Object({
      x: Type.Number({ description: 'Window-relative X coordinate in the latest screenshot.' }),
      y: Type.Number({ description: 'Window-relative Y coordinate in the latest screenshot.' }),
    }), { minItems: 2 })),
    scrollX: Type.Optional(Type.Number({ description: 'Signed horizontal scroll delta for action="scroll".' })),
    scrollY: Type.Optional(Type.Number({ description: 'Signed vertical scroll delta for action="scroll".' })),
    text: Type.Optional(Type.String({ description: 'Text to type for action="type".' })),
    keys: Type.Optional(Type.Array(Type.String({ description: 'Shortcut keys for action="keypress", for example CMD, V, ENTER.' }), { minItems: 1 })),
    ms: Type.Optional(Type.Number({ description: 'Milliseconds to wait for action="wait". Defaults to about 1000.' })),
    captureId: Type.Optional(Type.String({ description: 'Optional screenshot validation token from the latest observe result.' })),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    return await executeComputerUse(toolCallId, params, signal, onUpdate, ctx);
  },
});

export default function computerUseExtension(pi: ExtensionAPI): void {
  pi.registerTool(computerUseTool);

  pi.on('session_start', async (_event, ctx) => {
    reconstructStateFromBranch(ctx);
  });

  pi.on('session_tree', async (_event, ctx) => {
    reconstructStateFromBranch(ctx);
  });

  pi.on('session_shutdown', async () => {
    stopComputerUseHelper();
  });
}
