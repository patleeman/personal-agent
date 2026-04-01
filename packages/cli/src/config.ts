import {
  getMachineConfigFilePath,
  readMachineDefaultProfile,
  updateMachineConfig,
  writeMachineDefaultProfile,
} from '@personal-agent/core';

export interface PersonalAgentConfig {
  defaultProfile: string;
}

export function getConfigFilePath(): string {
  return getMachineConfigFilePath();
}

export function readConfig(): PersonalAgentConfig {
  return {
    defaultProfile: readMachineDefaultProfile(),
  };
}

export function writeConfig(config: PersonalAgentConfig): void {
  updateMachineConfig((current) => ({
    ...current,
    defaultProfile: config.defaultProfile,
  }));
}

export function setDefaultProfile(profile: string): void {
  writeMachineDefaultProfile(profile);
}
