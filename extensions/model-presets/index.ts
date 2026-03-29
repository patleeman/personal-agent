import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import {
  findMatchingModelPreset,
  formatModelPresetModelArgument,
  readModelPresetLibrary,
  resolveModelPreset,
  type ModelPresetLibrary,
  type ResolvedModelPreset,
} from '@personal-agent/resources';

const MODEL_PRESET_ACTION_VALUES = ['current', 'list', 'set'] as const;

type ModelPresetAction = (typeof MODEL_PRESET_ACTION_VALUES)[number];

const ModelPresetToolParams = Type.Object({
  action: Type.Union(MODEL_PRESET_ACTION_VALUES.map((value) => Type.Literal(value))),
  presetId: Type.Optional(Type.String({ description: 'Preset id for set.' })),
});

function expandHomePath(value: string): string {
  if (value === '~') {
    return homedir();
  }

  if (value.startsWith('~/')) {
    return join(homedir(), value.slice(2));
  }

  return value;
}

function getDefaultStateRoot(): string {
  const explicit = process.env.PERSONAL_AGENT_STATE_ROOT;
  if (explicit && explicit.trim().length > 0) {
    return resolve(expandHomePath(explicit.trim()));
  }

  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome && xdgStateHome.trim().length > 0) {
    return join(resolve(expandHomePath(xdgStateHome.trim())), 'personal-agent');
  }

  return join(homedir(), '.local', 'state', 'personal-agent');
}

function resolveAgentDir(): string {
  const explicit = process.env.PI_CODING_AGENT_DIR;
  if (explicit && explicit.trim().length > 0) {
    return resolve(expandHomePath(explicit.trim()));
  }

  return join(getDefaultStateRoot(), 'pi-agent-runtime');
}

function readSettingsObject(): Record<string, unknown> {
  const settingsFile = join(resolveAgentDir(), 'settings.json');
  if (!existsSync(settingsFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function readCurrentModelState(sessionManager: { buildSessionContext: () => unknown }, library: ModelPresetLibrary): {
  modelRef: string;
  thinkingLevel: string;
  matchedPreset: ResolvedModelPreset | null;
} {
  const context = sessionManager.buildSessionContext() as {
    model?: { provider?: string; modelId?: string; id?: string } | null;
    thinkingLevel?: string | null;
  };
  const provider = readNonEmptyString(context?.model?.provider);
  const modelId = readNonEmptyString(context?.model?.modelId ?? context?.model?.id);
  const modelRef = provider && modelId ? `${provider}/${modelId}` : modelId;
  const thinkingLevel = readNonEmptyString(context?.thinkingLevel);

  return {
    modelRef,
    thinkingLevel,
    matchedPreset: findMatchingModelPreset(library, { modelRef, thinkingLevel }),
  };
}

function formatPresetSummary(preset: ResolvedModelPreset): string {
  const lines = [
    `${preset.id}: ${preset.description || 'No description provided.'}`,
    `model: ${formatModelPresetModelArgument(preset)}`,
  ];

  if (preset.goodFor.length > 0) {
    lines.push(`good for: ${preset.goodFor.join(', ')}`);
  }

  if (preset.avoidFor.length > 0) {
    lines.push(`avoid for: ${preset.avoidFor.join(', ')}`);
  }

  return lines.join('\n');
}

function appendActivePresetInstructions(systemPrompt: string, preset: ResolvedModelPreset | null): string {
  if (!preset?.instructionAddendum) {
    return systemPrompt;
  }

  return [
    systemPrompt,
    '',
    `<active-model-preset id="${preset.id}">`,
    preset.instructionAddendum,
    '</active-model-preset>',
  ].join('\n');
}

function readRequiredPresetId(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error('presetId is required.');
  }

  return normalized;
}

export default function modelPresetsExtension(pi: ExtensionAPI): void {
  pi.on('before_agent_start', (event, ctx) => {
    const systemPrompt = event.systemPrompt?.trim();
    if (!systemPrompt) {
      return;
    }

    const settings = readSettingsObject();
    const library = readModelPresetLibrary(settings);
    if (library.presets.length === 0) {
      return;
    }

    const current = readCurrentModelState(ctx.sessionManager, library);
    return {
      systemPrompt: appendActivePresetInstructions(event.systemPrompt, current.matchedPreset),
    };
  });

  pi.registerTool({
    name: 'model_preset',
    label: 'Model Preset',
    description: 'Inspect and switch named model presets for the current session.',
    promptSnippet: 'Use model_preset to inspect and switch named model presets for the current session.',
    promptGuidelines: [
      'Use this tool when the current model is clearly oversized or undersized for the task.',
      'Prefer downgrading only for bounded low-risk work and upgrading for ambiguity, retries, or risky side effects.',
      'Use current or list before switching when the active preset is unclear.',
    ],
    parameters: ModelPresetToolParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const settings = readSettingsObject();
        const library = readModelPresetLibrary(settings);
        if (library.presets.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No model presets are configured for this session.' }],
            details: {
              action: params.action,
              presetCount: 0,
            },
          };
        }

        const current = readCurrentModelState(ctx.sessionManager, library);

        switch (params.action as ModelPresetAction) {
          case 'current': {
            const lines = current.matchedPreset
              ? [
                `Current model preset: ${current.matchedPreset.id}`,
                formatPresetSummary(current.matchedPreset),
              ]
              : [
                'Current model does not match a named preset.',
                `model: ${current.modelRef || '(unknown)'}`,
                `thinking: ${current.thinkingLevel || '(unknown)'}`,
              ];

            if (library.defaultPresetId) {
              lines.push(`default preset: ${library.defaultPresetId}`);
            }

            return {
              content: [{ type: 'text' as const, text: lines.join('\n') }],
              details: {
                action: 'current',
                currentPresetId: current.matchedPreset?.id ?? null,
                defaultPresetId: library.defaultPresetId || null,
                modelRef: current.modelRef,
                thinkingLevel: current.thinkingLevel,
              },
            };
          }

          case 'list': {
            return {
              content: [{
                type: 'text' as const,
                text: [
                  'Model presets:',
                  ...library.presets.map((preset) => {
                    const suffix = preset.id === current.matchedPreset?.id ? ' (current)' : preset.id === library.defaultPresetId ? ' (default)' : '';
                    return formatPresetSummary({ ...preset, id: `${preset.id}${suffix}` });
                  }),
                ].join('\n\n'),
              }],
              details: {
                action: 'list',
                presetIds: library.presets.map((preset) => preset.id),
                currentPresetId: current.matchedPreset?.id ?? null,
                defaultPresetId: library.defaultPresetId || null,
              },
            };
          }

          case 'set': {
            const presetId = readRequiredPresetId(params.presetId);
            const preset = resolveModelPreset(settings, presetId);
            if (!preset) {
              throw new Error(`Unknown model preset: ${presetId}`);
            }

            const targetModel = ctx.modelRegistry.getAvailable().find((model) => {
              if (preset.provider) {
                return model.provider === preset.provider && model.id === preset.model;
              }

              return model.id === preset.model;
            });
            if (!targetModel) {
              throw new Error(`Configured model for preset ${preset.id} is unavailable: ${preset.modelRef}`);
            }

            const currentPresetId = current.matchedPreset?.id ?? null;
            const switchedModel = current.modelRef !== preset.modelRef;
            const switchedThinking = Boolean(preset.thinkingLevel) && current.thinkingLevel !== preset.thinkingLevel;

            if (switchedModel) {
              const success = await pi.setModel(targetModel);
              if (!success) {
                throw new Error(`Could not switch to ${preset.modelRef}. Check API key availability for that model.`);
              }
            }

            if (preset.thinkingLevel) {
              pi.setThinkingLevel(preset.thinkingLevel);
            }

            const lines = [
              `Switched to model preset ${preset.id}.`,
              formatPresetSummary(preset),
            ];
            if (preset.instructionAddendum) {
              lines.push(`guidance: ${preset.instructionAddendum}`);
            }
            if (!switchedModel && !switchedThinking && currentPresetId === preset.id) {
              lines[0] = `Already using model preset ${preset.id}.`;
            }

            return {
              content: [{ type: 'text' as const, text: lines.join('\n') }],
              details: {
                action: 'set',
                presetId: preset.id,
                previousPresetId: currentPresetId,
                modelRef: preset.modelRef,
                thinkingLevel: preset.thinkingLevel,
                switchedModel,
                switchedThinking,
              },
            };
          }

          default:
            throw new Error(`Unsupported model_preset action: ${String(params.action)}`);
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true,
          details: {
            action: params.action,
          },
        };
      }
    },
  });
}
