import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

export interface PersonalAgentConfig {
  defaultProfile: string;
}

const DEFAULT_CONFIG: PersonalAgentConfig = {
  defaultProfile: 'shared',
};

export function getConfigFilePath(): string {
  const explicit = process.env.PERSONAL_AGENT_CONFIG_FILE;
  if (explicit && explicit.trim().length > 0) {
    return explicit;
  }

  return join(homedir(), '.config', 'personal-agent', 'config.json');
}

export function readConfig(): PersonalAgentConfig {
  const filePath = getConfigFilePath();
  if (!existsSync(filePath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<PersonalAgentConfig>;
    return {
      defaultProfile: parsed.defaultProfile || DEFAULT_CONFIG.defaultProfile,
    };
  } catch (error) {
    console.error(
      `Failed to read personal-agent config at ${filePath}: ${(error as Error).message}. ` +
      `Using defaults.`,
    );
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: PersonalAgentConfig): void {
  const filePath = getConfigFilePath();
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(config, null, 2));
}

export function setDefaultProfile(profile: string): void {
  const current = readConfig();
  writeConfig({
    ...current,
    defaultProfile: profile,
  });
}
