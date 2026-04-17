export type RemotePlatformKey = 'darwin-arm64' | 'darwin-x64' | 'linux-arm64' | 'linux-x64';

export interface RemotePlatformInfo {
  key: RemotePlatformKey;
  os: 'darwin' | 'linux';
  arch: 'arm64' | 'x64';
}

export function parseRemotePlatform(input: { os: string; arch: string }): RemotePlatformInfo {
  const os = input.os.trim().toLowerCase();
  const arch = input.arch.trim().toLowerCase();

  if (os === 'darwin' && (arch === 'arm64' || arch === 'aarch64')) {
    return { key: 'darwin-arm64', os: 'darwin', arch: 'arm64' };
  }
  if (os === 'darwin' && (arch === 'x86_64' || arch === 'amd64' || arch === 'x64')) {
    return { key: 'darwin-x64', os: 'darwin', arch: 'x64' };
  }
  if (os === 'linux' && (arch === 'arm64' || arch === 'aarch64')) {
    return { key: 'linux-arm64', os: 'linux', arch: 'arm64' };
  }
  if (os === 'linux' && (arch === 'x86_64' || arch === 'amd64' || arch === 'x64')) {
    return { key: 'linux-x64', os: 'linux', arch: 'x64' };
  }

  throw new Error(`Unsupported remote platform: ${input.os}/${input.arch}`);
}
