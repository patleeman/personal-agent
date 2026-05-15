export type PersonalAgentRuntimeChannel = 'stable' | 'rc' | 'dev' | 'test';

export interface PersonalAgentRuntimeChannelConfig {
  channel: PersonalAgentRuntimeChannel;
  stateRootSuffix: '' | '-rc' | '-dev' | '-testing';
  companionPort: number;
  codexPort: number;
  updatesEnabled: boolean;
}

const CHANNEL_CONFIGS: Record<PersonalAgentRuntimeChannel, PersonalAgentRuntimeChannelConfig> = {
  stable: { channel: 'stable', stateRootSuffix: '', companionPort: 3842, codexPort: 3846, updatesEnabled: true },
  rc: { channel: 'rc', stateRootSuffix: '-rc', companionPort: 3843, codexPort: 3847, updatesEnabled: true },
  dev: { channel: 'dev', stateRootSuffix: '-dev', companionPort: 3844, codexPort: 3848, updatesEnabled: false },
  test: { channel: 'test', stateRootSuffix: '-testing', companionPort: 0, codexPort: 0, updatesEnabled: false },
};

function isRcVersion(version?: string): boolean {
  return typeof version === 'string' && /-rc(?:\.|$)/iu.test(version);
}

function normalizeRuntimeChannel(value: string | undefined): PersonalAgentRuntimeChannel | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'stable' || normalized === 'prod' || normalized === 'production') return 'stable';
  if (normalized === 'rc') return 'rc';
  if (normalized === 'dev' || normalized === 'development') return 'dev';
  if (normalized === 'test' || normalized === 'testing') return 'test';
  return null;
}

export function resolvePersonalAgentRuntimeChannel(
  env: NodeJS.ProcessEnv = process.env,
  options: { version?: string; packaged?: boolean } = {},
): PersonalAgentRuntimeChannel {
  const explicit = normalizeRuntimeChannel(env.PERSONAL_AGENT_RUNTIME_CHANNEL ?? env.PERSONAL_AGENT_DESKTOP_VARIANT);
  if (explicit) return explicit;
  if (env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE === '1') return 'test';
  if (options.packaged && isRcVersion(options.version)) return 'rc';
  return 'stable';
}

export function getPersonalAgentRuntimeChannelConfig(channel: PersonalAgentRuntimeChannel): PersonalAgentRuntimeChannelConfig {
  return CHANNEL_CONFIGS[channel];
}

export function resolvePersonalAgentRuntimeChannelConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { version?: string; packaged?: boolean } = {},
): PersonalAgentRuntimeChannelConfig {
  return getPersonalAgentRuntimeChannelConfig(resolvePersonalAgentRuntimeChannel(env, options));
}

export function readPortOverride(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 0 && port <= 65535 ? port : undefined;
}
