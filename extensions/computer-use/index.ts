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
  description: 'Operate a visible macOS app window by observing it, acting on accessibility elements or coordinates, typing, setting values, pressing keys, or waiting.',
  promptSnippet: 'Operate a visible macOS app window through a screenshot-and-action loop, preferring accessibility elements over raw coordinates when available.',
  promptGuidelines: [
    `When the task requires interacting with a visible macOS app window, read the built-in computer-use internal skill at ${internalSkillPath} before using this tool.`,
    'Use action="observe" first to choose or refresh the current target window and get fresh accessibility element IDs.',
    'Prefer elementId-based actions over raw coordinates when observe returned a matching accessibility element.',
    'Use action="set_value" for settable text fields when possible, and fall back to action="type" only when direct value setting is unavailable.',
    'Coordinates are window-relative screenshot pixels from the latest capture result.',
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
      'set_value',
      'secondary_action',
    ] as const),
    app: Type.Optional(Type.String({ description: 'For action="observe", optional app name to target, for example Safari or TextEdit.' })),
    windowTitle: Type.Optional(Type.String({ description: 'For action="observe", optional window title filter.' })),
    x: Type.Optional(Type.Number({ description: 'Window-relative X coordinate in the latest screenshot. Optional when targeting an elementId.' })),
    y: Type.Optional(Type.Number({ description: 'Window-relative Y coordinate in the latest screenshot. Optional when targeting an elementId.' })),
    elementId: Type.Optional(Type.String({ description: 'Accessibility element ID from the latest observe result. Prefer this over coordinates when available.' })),
    button: Type.Optional(StringEnum(['left', 'right', 'wheel', 'back', 'forward'] as const)),
    path: Type.Optional(Type.Array(Type.Object({
      x: Type.Number({ description: 'Window-relative X coordinate in the latest screenshot.' }),
      y: Type.Number({ description: 'Window-relative Y coordinate in the latest screenshot.' }),
    }), { minItems: 2 })),
    scrollX: Type.Optional(Type.Number({ description: 'Signed horizontal scroll delta for action="scroll".' })),
    scrollY: Type.Optional(Type.Number({ description: 'Signed vertical scroll delta for action="scroll".' })),
    text: Type.Optional(Type.String({ description: 'Text for action="type" or action="set_value".' })),
    accessibilityAction: Type.Optional(Type.String({ description: 'Optional accessibility action name for action="secondary_action". Defaults to the first non-primary action exposed by the element.' })),
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
