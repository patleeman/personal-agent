import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, dirname, join, normalize } from 'path';

export type ModelPresetThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

const MODEL_PRESET_THINKING_LEVELS = new Set<ModelPresetThinkingLevel>([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

export interface ResolvedModelPresetTarget {
  provider: string;
  model: string;
  modelRef: string;
  thinkingLevel: ModelPresetThinkingLevel | '';
  kind: 'primary' | 'fallback';
}

export interface ResolvedModelPreset {
  id: string;
  description: string;
  provider: string;
  model: string;
  modelRef: string;
  thinkingLevel: ModelPresetThinkingLevel | '';
  fallbacks: ResolvedModelPresetTarget[];
  goodFor: string[];
  avoidFor: string[];
  instructionAddendum: string;
}

export interface ModelPresetLibrary {
  defaultPresetId: string;
  presets: ResolvedModelPreset[];
}

export interface ModelPresetSkillHint {
  skillName: string;
  presetId: string;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function normalizeThinkingLevel(value: unknown): ModelPresetThinkingLevel | '' {
  const normalized = readNonEmptyString(value).toLowerCase();
  return MODEL_PRESET_THINKING_LEVELS.has(normalized as ModelPresetThinkingLevel)
    ? normalized as ModelPresetThinkingLevel
    : '';
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => readNonEmptyString(entry))
    .filter((entry): entry is string => entry.length > 0);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function splitModelRefAndThinking(value: string): { modelRef: string; thinkingLevel: ModelPresetThinkingLevel | '' } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { modelRef: '', thinkingLevel: '' };
  }

  const lastColonIndex = trimmed.lastIndexOf(':');
  if (lastColonIndex <= 0 || lastColonIndex === trimmed.length - 1) {
    return { modelRef: trimmed, thinkingLevel: '' };
  }

  const suffix = trimmed.slice(lastColonIndex + 1).trim().toLowerCase();
  if (!MODEL_PRESET_THINKING_LEVELS.has(suffix as ModelPresetThinkingLevel)) {
    return { modelRef: trimmed, thinkingLevel: '' };
  }

  return {
    modelRef: trimmed.slice(0, lastColonIndex).trim(),
    thinkingLevel: suffix as ModelPresetThinkingLevel,
  };
}

function resolveModelReference(modelValue: string, providerValue: string): { provider: string; model: string; modelRef: string; thinkingLevel: ModelPresetThinkingLevel | '' } {
  const split = splitModelRefAndThinking(modelValue);
  const normalizedModelRef = split.modelRef;
  if (!normalizedModelRef) {
    return { provider: '', model: '', modelRef: '', thinkingLevel: split.thinkingLevel };
  }

  const slashIndex = normalizedModelRef.indexOf('/');
  if (slashIndex > 0 && slashIndex < normalizedModelRef.length - 1) {
    return {
      provider: normalizedModelRef.slice(0, slashIndex),
      model: normalizedModelRef.slice(slashIndex + 1),
      modelRef: normalizedModelRef,
      thinkingLevel: split.thinkingLevel,
    };
  }

  if (!providerValue) {
    return {
      provider: '',
      model: normalizedModelRef,
      modelRef: normalizedModelRef,
      thinkingLevel: split.thinkingLevel,
    };
  }

  return {
    provider: providerValue,
    model: normalizedModelRef,
    modelRef: `${providerValue}/${normalizedModelRef}`,
    thinkingLevel: split.thinkingLevel,
  };
}

function normalizePresetTarget(value: unknown, kind: 'primary' | 'fallback'): ResolvedModelPresetTarget | null {
  if (typeof value === 'string') {
    const resolved = resolveModelReference(readNonEmptyString(value), '');
    return resolved.modelRef
      ? {
        provider: resolved.provider,
        model: resolved.model,
        modelRef: resolved.modelRef,
        thinkingLevel: resolved.thinkingLevel,
        kind,
      }
      : null;
  }

  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const providerValue = readNonEmptyString(record.provider);
  const modelValue = readNonEmptyString(record.model);
  const resolved = resolveModelReference(modelValue, providerValue);
  if (!resolved.modelRef) {
    return null;
  }

  const explicitThinkingLevel = normalizeThinkingLevel(record.thinkingLevel);
  return {
    provider: resolved.provider,
    model: resolved.model,
    modelRef: resolved.modelRef,
    thinkingLevel: explicitThinkingLevel || resolved.thinkingLevel,
    kind,
  };
}

function normalizeFallbackTargets(value: unknown): ResolvedModelPresetTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizePresetTarget(entry, 'fallback'))
    .filter((entry): entry is ResolvedModelPresetTarget => entry !== null);
}

export function listModelPresetTargets(preset: Pick<ResolvedModelPreset, 'provider' | 'model' | 'modelRef' | 'thinkingLevel' | 'fallbacks'>): ResolvedModelPresetTarget[] {
  return [
    {
      provider: preset.provider,
      model: preset.model,
      modelRef: preset.modelRef,
      thinkingLevel: preset.thinkingLevel,
      kind: 'primary',
    },
    ...preset.fallbacks,
  ];
}

export function readModelPresetLibrary(settings: Record<string, unknown>): ModelPresetLibrary {
  const presetsValue = readRecord(settings.modelPresets);
  const presets: ResolvedModelPreset[] = [];

  if (presetsValue) {
    for (const [id, rawPreset] of Object.entries(presetsValue)) {
      const preset = readRecord(rawPreset);
      if (!preset) {
        continue;
      }

      const description = readNonEmptyString(preset.description);
      const primaryTarget = normalizePresetTarget({
        provider: preset.provider,
        model: preset.model,
        thinkingLevel: preset.thinkingLevel,
      }, 'primary');
      if (!primaryTarget) {
        continue;
      }

      presets.push({
        id,
        description,
        provider: primaryTarget.provider,
        model: primaryTarget.model,
        modelRef: primaryTarget.modelRef,
        thinkingLevel: primaryTarget.thinkingLevel,
        fallbacks: normalizeFallbackTargets(preset.fallbacks),
        goodFor: normalizeStringList(preset.goodFor),
        avoidFor: normalizeStringList(preset.avoidFor),
        instructionAddendum: readNonEmptyString(preset.instructionAddendum),
      });
    }
  }

  const defaultPresetId = readNonEmptyString(settings.defaultModelPreset);
  return {
    defaultPresetId,
    presets: presets.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function resolveModelPreset(
  settings: Record<string, unknown>,
  presetId: string,
): ResolvedModelPreset | null {
  const normalizedPresetId = readNonEmptyString(presetId);
  if (!normalizedPresetId) {
    return null;
  }

  return readModelPresetLibrary(settings).presets.find((preset) => preset.id === normalizedPresetId) ?? null;
}

export function formatModelPresetModelArgument(preset: Pick<ResolvedModelPreset, 'modelRef' | 'thinkingLevel'>): string {
  return preset.thinkingLevel ? `${preset.modelRef}:${preset.thinkingLevel}` : preset.modelRef;
}

export function applyDefaultModelPresetToSettings(
  settings: Record<string, unknown>,
  options: { overwrite?: boolean } = {},
): Record<string, unknown> {
  const next = { ...settings };
  const library = readModelPresetLibrary(next);
  const defaultPreset = library.defaultPresetId
    ? library.presets.find((preset) => preset.id === library.defaultPresetId)
    : null;

  if (!defaultPreset) {
    return next;
  }

  const overwrite = options.overwrite === true;
  const hasDefaultModel = readNonEmptyString(next.defaultModel).length > 0;
  const hasDefaultProvider = readNonEmptyString(next.defaultProvider).length > 0;
  const hasDefaultThinkingLevel = normalizeThinkingLevel(next.defaultThinkingLevel).length > 0;

  if (overwrite || !hasDefaultModel) {
    next.defaultModel = defaultPreset.model;
  }

  if (defaultPreset.provider) {
    if (overwrite || !hasDefaultProvider) {
      next.defaultProvider = defaultPreset.provider;
    }
  } else if (overwrite) {
    delete next.defaultProvider;
  }

  if (defaultPreset.thinkingLevel) {
    if (overwrite || !hasDefaultThinkingLevel) {
      next.defaultThinkingLevel = defaultPreset.thinkingLevel;
    }
  } else if (overwrite) {
    delete next.defaultThinkingLevel;
  }

  return next;
}

export function findMatchingModelPreset(
  library: ModelPresetLibrary,
  current: { modelRef?: string | null; thinkingLevel?: string | null },
): ResolvedModelPreset | null {
  const modelRef = readNonEmptyString(current.modelRef ?? '');
  if (!modelRef) {
    return library.defaultPresetId
      ? library.presets.find((preset) => preset.id === library.defaultPresetId) ?? null
      : null;
  }

  const thinkingLevel = normalizeThinkingLevel(current.thinkingLevel ?? '');
  const matchesTarget = (target: Pick<ResolvedModelPresetTarget, 'modelRef' | 'thinkingLevel'>): boolean => {
    if (target.modelRef !== modelRef) {
      return false;
    }

    if (!target.thinkingLevel) {
      return thinkingLevel === '';
    }

    return target.thinkingLevel === thinkingLevel;
  };

  const exactMatch = library.presets.find((preset) => listModelPresetTargets(preset).some(matchesTarget));
  if (exactMatch) {
    return exactMatch;
  }

  return library.presets.find((preset) => listModelPresetTargets(preset).some((target) => target.modelRef === modelRef && !target.thinkingLevel)) ?? null;
}

function extractFrontmatterBlock(content: string): string {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  return match?.[1] ?? '';
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const body = extractFrontmatterBlock(content);
  if (!body) {
    return {};
  }

  const output: Record<string, unknown> = {};
  const lines = body.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const normalizedValue = rawValue.trim();
    if (!normalizedValue) {
      const items: string[] = [];
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const itemLine = lines[cursor] ?? '';
        const itemMatch = itemLine.match(/^\s+-\s+(.*)$/);
        if (!itemMatch) {
          index = cursor - 1;
          break;
        }

        items.push(itemMatch[1].trim().replace(/^['"]|['"]$/g, ''));
        index = cursor;
      }
      output[key] = items;
      continue;
    }

    output[key] = normalizedValue.replace(/^['"]|['"]$/g, '');
  }

  return output;
}

function readFrontmatterValue(frontmatter: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = readNonEmptyString(frontmatter[key]);
    if (value) {
      return value;
    }
  }

  return '';
}

function isSkillDefinitionFile(filePath: string): boolean {
  const fileName = basename(filePath);
  if (fileName === 'SKILL.md') {
    return true;
  }

  if (fileName !== 'INDEX.md') {
    return false;
  }

  const frontmatter = parseFrontmatter(readFileSync(filePath, 'utf-8'));
  const kind = readNonEmptyString(frontmatter.kind).toLowerCase();
  return kind === 'skill'
    || (readNonEmptyString(frontmatter.name).length > 0 && readNonEmptyString(frontmatter.description).length > 0);
}

function listSkillDefinitionFiles(skillDirs: string[]): string[] {
  const files: string[] = [];
  const seen = new Set<string>();

  for (const skillDir of skillDirs) {
    if (!existsSync(skillDir)) {
      continue;
    }

    const stack = [normalize(skillDir)];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const fullPath = join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const normalizedPath = normalize(fullPath);
        if (seen.has(normalizedPath)) {
          continue;
        }

        if (isSkillDefinitionFile(normalizedPath)) {
          seen.add(normalizedPath);
          files.push(normalizedPath);
        }
      }
    }
  }

  return files.sort();
}

export function collectSkillModelPresetHints(skillDirs: string[]): ModelPresetSkillHint[] {
  const hints: ModelPresetSkillHint[] = [];
  const seenSkillNames = new Set<string>();

  for (const skillFile of listSkillDefinitionFiles(skillDirs)) {
    try {
      const frontmatter = parseFrontmatter(readFileSync(skillFile, 'utf-8'));
      const skillName = readFrontmatterValue(frontmatter, ['name']) || basename(dirname(skillFile));
      const presetId = readFrontmatterValue(frontmatter, [
        'preferredModelPreset',
        'preferred-model-preset',
        'modelPreset',
        'model-preset',
      ]);

      if (!skillName || !presetId || seenSkillNames.has(skillName)) {
        continue;
      }

      seenSkillNames.add(skillName);
      hints.push({ skillName, presetId });
    } catch {
      // Ignore malformed skill files while building prompt-time routing hints.
    }
  }

  return hints.sort((left, right) => left.skillName.localeCompare(right.skillName));
}

export function buildModelPresetSystemPrompt(
  settings: Record<string, unknown>,
  options: { skillDirs?: string[] } = {},
): string {
  const library = readModelPresetLibrary(settings);
  if (library.presets.length === 0) {
    return '';
  }

  const skillHints = (options.skillDirs ? collectSkillModelPresetHints(options.skillDirs) : [])
    .filter((hint) => library.presets.some((preset) => preset.id === hint.presetId));

  const lines = [
    '<model-presets>',
    'Named model presets are available for routing work within this conversation.',
    library.defaultPresetId
      ? `Default preset: ${library.defaultPresetId}`
      : 'Default preset: none explicitly configured',
    'Use the model_preset tool to switch the current session when the current model is clearly oversized or undersized for the task.',
    '',
    'Preset summaries:',
    ...library.presets.map((preset) => {
      const summaryLines = [
        `- ${preset.id}: ${preset.description || 'No description provided.'}`,
        `  model: ${formatModelPresetModelArgument(preset)}`,
      ];
      if (preset.fallbacks.length > 0) {
        summaryLines.push(`  fallbacks: ${preset.fallbacks.map((fallback) => formatModelPresetModelArgument(fallback)).join(', ')}`);
      }
      if (preset.goodFor.length > 0) {
        summaryLines.push(`  good for: ${preset.goodFor.join(', ')}`);
      }
      if (preset.avoidFor.length > 0) {
        summaryLines.push(`  avoid for: ${preset.avoidFor.join(', ')}`);
      }
      return summaryLines.join('\n');
    }),
    '',
    'Routing guidance:',
    '- Start on the default preset unless the task is obviously much simpler or much harder.',
    '- Downgrade only for bounded, low-risk, low-judgment work.',
    '- Upgrade when the task is ambiguous, risky, retrying, or explicitly asks for deeper thinking.',
  ];

  if (skillHints.length > 0) {
    lines.push('', 'Skill preset hints:');
    lines.push(...skillHints.map((hint) => `- @${hint.skillName}: prefer ${hint.presetId}`));
    lines.push('- Skill hints are preferences, not hard requirements. Escalate when the actual task state is riskier or messier than expected.');
  }

  lines.push('</model-presets>');
  return lines.join('\n');
}
