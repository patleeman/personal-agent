import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function normalizedEnvPath(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

export function getDefaultStateRoot() {
  const xdgStateHome = normalizedEnvPath(process.env.XDG_STATE_HOME);
  if (xdgStateHome) {
    return path.resolve(xdgStateHome, 'personal-agent');
  }

  return path.resolve(os.homedir(), '.local', 'state', 'personal-agent');
}

export function getStateRoot() {
  const configuredStateRoot = normalizedEnvPath(process.env.PERSONAL_AGENT_STATE_ROOT);
  return configuredStateRoot ? path.resolve(configuredStateRoot) : getDefaultStateRoot();
}

export function getProfilesRoot() {
  const configuredProfilesRoot = normalizedEnvPath(process.env.PERSONAL_AGENT_PROFILES_ROOT);
  return configuredProfilesRoot ? path.resolve(configuredProfilesRoot) : path.resolve(getStateRoot(), 'profiles');
}

export function getPiAgentSessionsRoot() {
  return path.resolve(getStateRoot(), 'pi-agent', 'sessions');
}

export function getConversationMaintenanceIndexPath(profile) {
  const normalizedProfile = typeof profile === 'string' ? profile.trim() : '';
  if (!normalizedProfile) {
    throw new Error('profile is required');
  }

  return path.resolve(
    getStateRoot(),
    'conversation-maintenance',
    normalizedProfile,
    'processed-conversations.json',
  );
}

export function getLegacyConversationMaintenanceIndexPath(profile, cwd = process.cwd()) {
  const normalizedProfile = typeof profile === 'string' ? profile.trim() : '';
  if (!normalizedProfile) {
    throw new Error('profile is required');
  }

  return path.resolve(
    cwd,
    `profiles/${normalizedProfile}/agent/state/conversation-maintenance/processed-conversations.json`,
  );
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureConversationMaintenanceIndexPath(profile, cwd = process.cwd()) {
  const indexPath = getConversationMaintenanceIndexPath(profile);
  if (await pathExists(indexPath)) {
    return {
      indexPath,
      migratedFrom: null,
    };
  }

  const legacyPath = getLegacyConversationMaintenanceIndexPath(profile, cwd);
  if (!(await pathExists(legacyPath))) {
    return {
      indexPath,
      migratedFrom: null,
    };
  }

  await fs.mkdir(path.dirname(indexPath), { recursive: true });

  try {
    await fs.rename(legacyPath, indexPath);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code !== 'EXDEV') {
      throw error;
    }

    await fs.copyFile(legacyPath, indexPath);
    await fs.unlink(legacyPath);
  }

  return {
    indexPath,
    migratedFrom: legacyPath,
  };
}
