import { getDaemonStatus, loadDaemonConfig, pingDaemon, setDaemonPowerKeepAwake, writeDaemonPowerConfig } from '@personal-agent/daemon';

interface PowerState {
  keepAwake: boolean;
  supported: boolean;
  active: boolean;
  error?: string;
  daemonConnected: boolean;
}

/**
 * Read the current daemon power state.
 */
export async function readPowerState(): Promise<PowerState> {
  const config = loadDaemonConfig();
  const configAwake = config.power?.keepAwake === true;

  const daemonConnected = await pingDaemon(config).catch(() => false);
  if (!daemonConnected) {
    return {
      keepAwake: configAwake,
      supported: process.platform === 'darwin',
      active: false,
      daemonConnected: false,
      ...(configAwake ? { error: 'Daemon is not running.' } : {}),
    };
  }

  const status = await getDaemonStatus(config);
  return {
    keepAwake: status.power.keepAwake,
    supported: status.power.supported,
    active: status.power.active,
    ...(status.power.error ? { error: status.power.error } : {}),
    daemonConnected: true,
  };
}

/**
 * Set the daemon keep-awake state and return the updated power state.
 */
export async function setPowerKeepAwake(input: { keepAwake: boolean }): Promise<PowerState> {
  const config = loadDaemonConfig();

  writeDaemonPowerConfig({ keepAwake: input.keepAwake });

  const daemonConnected = await pingDaemon(config).catch(() => false);
  if (!daemonConnected) {
    return {
      keepAwake: input.keepAwake,
      supported: process.platform === 'darwin',
      active: false,
      daemonConnected: false,
    };
  }

  await setDaemonPowerKeepAwake(input.keepAwake, config);

  const status = await getDaemonStatus(config);
  return {
    keepAwake: status.power.keepAwake,
    supported: status.power.supported,
    active: status.power.active,
    ...(status.power.error ? { error: status.power.error } : {}),
    daemonConnected: true,
  };
}
