const DEFAULT_DESKTOP_RELEASE_REPO_SLUG = 'patleeman/personal-agent-releases';

function resolveDesktopReleaseRepoSlug(value = process.env.PERSONAL_AGENT_RELEASE_REPO) {
  const normalizedValue = value?.trim() || DEFAULT_DESKTOP_RELEASE_REPO_SLUG;
  const parts = normalizedValue.split('/').map((part) => part.trim()).filter((part) => part.length > 0);
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
  appId: 'nyc.patricklee.personal-agent',
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
    'assets/**/*',
    '!node_modules/@personal-agent/*/node_modules{,/**/*}',
    '!node_modules/@personal-agent/*/src{,/**/*}',
    '!node_modules/@personal-agent/*/server{,/**/*}',
    '!node_modules/@personal-agent/*/app{,/**/*}',
    '!node_modules/@personal-agent/*/public{,/**/*}',
    '!node_modules/@personal-agent/*/dist/**/*.test.js',
    '!node_modules/@personal-agent/*/dist-server/**/*.test.js',
    '!node_modules/@personal-agent/*/tsconfig*.json',
    '!node_modules/@personal-agent/*/vite.config.ts',
    '!node_modules/@personal-agent/*/postcss.config.js',
    '!node_modules/@personal-agent/*/tailwind.config.js',
  ],
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
    },
    {
      from: 'internal-skills',
      to: 'internal-skills',
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
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    extendInfo: {
      LSUIElement: true,
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
