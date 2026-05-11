const DEFAULT_DESKTOP_RELEASE_REPO_SLUG = 'patleeman/personal-agent';

function resolveDesktopReleaseRepoSlug(value = process.env.PERSONAL_AGENT_RELEASE_REPO) {
  const normalizedValue = value?.trim() || DEFAULT_DESKTOP_RELEASE_REPO_SLUG;
  const parts = normalizedValue
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length !== 2) {
    return DEFAULT_DESKTOP_RELEASE_REPO_SLUG;
  }

  return `${parts[0]}/${parts[1]}`;
}

export const DESKTOP_RELEASE_REPO_SLUG = resolveDesktopReleaseRepoSlug();
const [DESKTOP_RELEASE_REPO_OWNER, DESKTOP_RELEASE_REPO_NAME] = DESKTOP_RELEASE_REPO_SLUG.split('/', 2);

export const desktopReleasePublishConfig = {
  provider: 'github',
  owner: DESKTOP_RELEASE_REPO_OWNER,
  repo: DESKTOP_RELEASE_REPO_NAME,
  releaseType: 'release',
};

const electronBuilderConfig = {
  appId: 'com.personal-agent.desktop',
  productName: 'Personal Agent',
  directories: {
    app: 'packages/desktop',
    output: 'dist/release',
  },
  files: [
    'dist/**/*.js',
    'dist/**/*.cjs',
    '!dist/**/*.test.js',
    '!dist/mac{,/**/*}',
    'ui/dist/**/*',
    'server/dist/**/*',
    'server/extensions/backendApi/*.ts',
    'assets/**/*',
    '!ui/src{,/**/*}',
    '!server/src{,/**/*}',
    '!server/app{,/**/*}',
    '!ui/tsconfig*.json',
    '!ui/vite.config.ts',
    '!ui/postcss.config.js',
    '!ui/tailwind.config.js',
    '!node_modules/@personal-agent/*/node_modules{,/**/*}',
    '!node_modules/@personal-agent/*/src{,/**/*}',
    '!node_modules/@personal-agent/*/app{,/**/*}',
    '!node_modules/@personal-agent/*/public{,/**/*}',
    '!node_modules/@personal-agent/*/dist/**/*.test.js',
    '!node_modules/@personal-agent/*/tsconfig*.json',
    '!node_modules/@personal-agent/*/vite.config.ts',
    '!node_modules/@personal-agent/*/postcss.config.js',
    '!node_modules/@personal-agent/*/tailwind.config.js',
    '!node_modules/esbuild{,/**/*}',
    '!node_modules/@esbuild{,/**/*}',
    '!node_modules/**/*.map',
    '!node_modules/koffi/{doc,src,vendor,lib/native}{,/**/*}',
    '!node_modules/koffi/build/koffi/{darwin_x64,freebsd_arm64,freebsd_ia32,freebsd_x64,linux_arm64,linux_armhf,linux_ia32,linux_loong64,linux_riscv64d,linux_x64,musl_arm64,musl_x64,openbsd_ia32,openbsd_x64,win32_arm64,win32_ia32,win32_x64}{,/**/*}',
    '!node_modules/@mariozechner/clipboard-darwin-universal{,/**/*}',
    '!node_modules/better-sqlite3/{deps,src}{,/**/*}',
    '!node_modules/better-sqlite3/build/Release/obj{,/**/*}',
  ],
  asarUnpack: ['node_modules/better-sqlite3/**/*', 'node_modules/bindings/**/*', 'node_modules/file-uri-to-path/**/*'],
  extraMetadata: {
    main: './dist/main.js',
  },
  electronUpdaterCompatibility: '>=2.16',
  publish: desktopReleasePublishConfig,
  icon: 'packages/desktop/assets/icon.png',
  extraResources: [
    {
      from: 'defaults',
      to: 'defaults',
    },
    {
      from: 'extensions',
      to: 'extensions',
      filter: ['**/*', '!**/src{,/**/*}'],
    },
    {
      from: 'docs',
      to: 'docs',
    },
    {
      from: 'prompt-catalog',
      to: 'prompt-catalog',
    },
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'packages/desktop/assets/icon.icns',
    hardenedRuntime: true,
    notarize: false,
    entitlements: 'apps/mac/entitlements.mac.plist',
    entitlementsInherit: 'apps/mac/entitlements.mac.inherit.plist',
    extendInfo: {
      LSUIElement: true,
      NSMicrophoneUsageDescription: 'Personal Agent uses the microphone to capture composer dictation.',
    },
    target: [
      {
        target: 'dmg',
        arch: ['arm64'],
      },
      {
        target: 'zip',
        arch: ['arm64'],
      },
    ],
    artifactName: 'Personal-Agent-${version}-mac-${arch}.${ext}',
  },
};

export default electronBuilderConfig;
