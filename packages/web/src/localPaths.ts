const WINDOWS_ABSOLUTE_PATH_REGEX = /^[A-Za-z]:[\\/]/;

export function looksLikeLocalFilesystemPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('\n') || trimmed.includes('\r')) {
    return false;
  }

  return trimmed.startsWith('/') || trimmed.startsWith('~/') || WINDOWS_ABSOLUTE_PATH_REGEX.test(trimmed);
}
