const WINDOWS_ABSOLUTE_PATH_REGEX = /^[A-Za-z]:[\\/]/;
const KNOWN_UNIX_ROOT_PATHS = new Set([
  'Applications',
  'bin',
  'cores',
  'dev',
  'etc',
  'home',
  'Library',
  'mnt',
  'opt',
  'private',
  'proc',
  'root',
  'run',
  'sbin',
  'srv',
  'System',
  'tmp',
  'Users',
  'usr',
  'var',
  'Volumes',
]);
const BARE_SLASH_TOKEN_REGEX = /^\/[A-Za-z0-9:_-]+$/;

function isLikelySlashCommand(value: string): boolean {
  if (!BARE_SLASH_TOKEN_REGEX.test(value)) {
    return false;
  }

  const rootName = value.slice(1);
  return !KNOWN_UNIX_ROOT_PATHS.has(rootName);
}

export function looksLikeLocalFilesystemPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('\n') || trimmed.includes('\r')) {
    return false;
  }

  if (trimmed.startsWith('~/')) {
    return trimmed.length > 2;
  }

  if (WINDOWS_ABSOLUTE_PATH_REGEX.test(trimmed)) {
    return true;
  }

  if (!trimmed.startsWith('/')) {
    return false;
  }

  return !isLikelySlashCommand(trimmed);
}
