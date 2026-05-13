export {
  cancelDurableRun,
  followUpDurableRun,
  getDurableRun,
  getDurableRunLog,
  listDurableRuns,
  rerunDurableRun,
} from '../../automation/durableRuns.js';
export { applyScheduledTaskThreadBinding } from '../../automation/scheduledTaskThreads.js';
export { invalidateAppTopics } from '../../shared/appEvents.js';

async function loadDaemon() {
  return import('@personal-agent/daemon');
}

export async function startBackgroundRun(...args: Parameters<(typeof import('@personal-agent/daemon'))['startBackgroundRun']>) {
  const daemon = await loadDaemon();
  return daemon.startBackgroundRun(...args);
}
