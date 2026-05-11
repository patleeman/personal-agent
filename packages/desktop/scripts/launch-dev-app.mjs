/* eslint-env node */

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureElectronNativeModules, readElectronNativeModulesDir } from './ensure-electron-native-modules.mjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(currentDir, '..');
const repoRoot = resolve(packageDir, '..', '..');
const desktopMainFile = resolve(packageDir, 'dist', 'main.js');
const desktopPackageJson = resolve(packageDir, 'package.json');
const desktopIconFile = resolve(packageDir, 'assets', 'icon.icns');
const electronBinary = resolve(repoRoot, 'node_modules', '.bin', 'electron');
const sourceMacAppBundle = resolve(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app');
const macDevAppDir = resolve(repoRoot, 'dist', 'dev-desktop');
const desktopVariant = 'testing';
const testingProductSuffix = ' Testing';
const desktopLaunchArgs = process.argv.slice(2);
const ELECTRON_SWITCH_PREFIXES = [
  '--remote-debugging-port',
  '--inspect',
  '--inspect-brk',
  '--js-flags',
  '--enable-logging',
  '--trace-startup',
];

function isElectronSwitch(arg) {
  return ELECTRON_SWITCH_PREFIXES.some((prefix) => arg === prefix || arg.startsWith(`${prefix}=`));
}

function splitDesktopLaunchArgs(args = []) {
  const electronSwitches = [];
  const appArgs = [];

  for (const arg of args) {
    if (isElectronSwitch(arg)) {
      electronSwitches.push(arg);
    } else {
      appArgs.push(arg);
    }
  }

  return { electronSwitches, appArgs };
}

function shouldSkipQuitConfirmationForLaunch(args = []) {
  return args.includes('--no-quit-confirmation') || args.includes('--skip-quit-confirmation');
}

function buildDesktopLaunchEnv(baseEnv = process.env, args = []) {
  return {
    ...baseEnv,
    PERSONAL_AGENT_DESKTOP_VARIANT: desktopVariant,
    PERSONAL_AGENT_DESKTOP_NATIVE_MODULES_DIR: readElectronNativeModulesDir(),
    PERSONAL_AGENT_REPO_ROOT: repoRoot,
    CODEX_PORT: '3846',
    ...(baseEnv.PERSONAL_AGENT_DESKTOP_SKIP_QUIT_CONFIRMATION?.trim() || !shouldSkipQuitConfirmationForLaunch(args)
      ? {}
      : { PERSONAL_AGENT_DESKTOP_SKIP_QUIT_CONFIRMATION: '1' }),
  };
}

if (!existsSync(desktopMainFile)) {
  console.error(`Missing desktop entrypoint: ${desktopMainFile}`);
  process.exit(1);
}

ensureElectronNativeModules();

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function runChecked(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf-8' });
  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `Command failed: ${command} ${args.join(' ')}`);
  }
}

function readElectronVersion() {
  return readFileSync(resolve(repoRoot, 'node_modules', 'electron', 'dist', 'version'), 'utf-8').trim();
}

function createMacDevAppStamp(productName, appVersion) {
  return {
    bundleLayoutVersion: 3,
    productName,
    appVersion,
    electronVersion: readElectronVersion(),
    iconMtimeMs: statSync(desktopIconFile).mtimeMs,
  };
}

function readExistingStamp(path) {
  if (!existsSync(path)) {
    return null;
  }

  try {
    return readJson(path);
  } catch {
    return null;
  }
}

function replacePlistString(infoPlistPath, key, value) {
  runChecked('plutil', ['-replace', key, '-string', value, infoPlistPath]);
}

function ensureMacDevAppBundle() {
  if (!existsSync(sourceMacAppBundle)) {
    throw new Error(`Missing Electron app bundle: ${sourceMacAppBundle}`);
  }

  const desktopPackage = readJson(desktopPackageJson);
  const baseProductName =
    typeof desktopPackage.productName === 'string' && desktopPackage.productName.trim().length > 0
      ? desktopPackage.productName.trim()
      : 'Personal Agent';
  const productName = `${baseProductName}${testingProductSuffix}`;
  const appVersion =
    typeof desktopPackage.version === 'string' && desktopPackage.version.trim().length > 0 ? desktopPackage.version.trim() : '0.0.0';
  const appBundlePath = resolve(macDevAppDir, `${productName}.app`);
  const executablePath = resolve(appBundlePath, 'Contents', 'MacOS', productName);
  const stampPath = resolve(macDevAppDir, 'stamp.json');
  const desiredStamp = createMacDevAppStamp(productName, appVersion);
  const existingStamp = readExistingStamp(stampPath);

  if (existsSync(executablePath) && JSON.stringify(existingStamp) === JSON.stringify(desiredStamp)) {
    return {
      appBundlePath,
      executablePath,
    };
  }

  rmSync(macDevAppDir, { recursive: true, force: true });
  mkdirSync(macDevAppDir, { recursive: true });
  runChecked('ditto', [sourceMacAppBundle, appBundlePath]);

  const originalExecutablePath = resolve(appBundlePath, 'Contents', 'MacOS', 'Electron');
  renameSync(originalExecutablePath, executablePath);
  cpSync(desktopIconFile, resolve(appBundlePath, 'Contents', 'Resources', 'icon.icns'));

  const infoPlistPath = resolve(appBundlePath, 'Contents', 'Info.plist');
  replacePlistString(infoPlistPath, 'CFBundleDisplayName', productName);
  replacePlistString(infoPlistPath, 'CFBundleName', productName);
  replacePlistString(infoPlistPath, 'CFBundleExecutable', productName);
  replacePlistString(infoPlistPath, 'CFBundleIconFile', 'icon.icns');
  replacePlistString(infoPlistPath, 'CFBundleIdentifier', 'com.personal-agent.desktop.dev');
  replacePlistString(infoPlistPath, 'CFBundleShortVersionString', appVersion);
  replacePlistString(infoPlistPath, 'CFBundleVersion', appVersion);

  writeFileSync(stampPath, `${JSON.stringify(desiredStamp, null, 2)}\n`);
  return {
    appBundlePath,
    executablePath,
  };
}

async function waitForDetachedLaunch(child) {
  return new Promise((resolveExitCode) => {
    const startupWindowMs = 3_000;
    let settled = false;

    const finish = (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveExitCode(code);
    };

    const timer = setTimeout(() => {
      if (child.exitCode !== null) {
        return;
      }

      child.unref();
      finish(0);
    }, startupWindowMs);
    timer.unref();

    child.once('error', (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      finish(1);
    });

    child.once('exit', (code, signal) => {
      if (signal) {
        console.error(`Desktop app exited during startup (signal ${signal}).`);
      }
      finish(typeof code === 'number' ? code : 1);
    });
  });
}

async function launchMacDevApp() {
  const { appBundlePath } = ensureMacDevAppBundle();
  const { electronSwitches, appArgs } = splitDesktopLaunchArgs(desktopLaunchArgs);
  const child = spawn('open', ['-n', appBundlePath, '--args', ...electronSwitches, desktopMainFile, ...appArgs], {
    stdio: 'ignore',
    cwd: packageDir,
    env: {
      ...buildDesktopLaunchEnv(process.env, desktopLaunchArgs),
      PERSONAL_AGENT_DESKTOP_DEV_BUNDLE: '1',
    },
    detached: true,
  });

  process.exit(await waitForDetachedLaunch(child));
}

if (process.platform === 'darwin') {
  await launchMacDevApp();
}

const { electronSwitches, appArgs } = splitDesktopLaunchArgs(desktopLaunchArgs);
const result = spawnSync(electronBinary, [...electronSwitches, desktopMainFile, ...appArgs], {
  stdio: 'inherit',
  cwd: packageDir,
  env: buildDesktopLaunchEnv(process.env, desktopLaunchArgs),
});

process.exit(result.status ?? 1);
