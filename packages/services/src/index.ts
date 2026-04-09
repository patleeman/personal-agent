export {
  getManagedDaemonServiceStatus,
  installManagedDaemonService,
  restartManagedDaemonServiceIfInstalled,
  startManagedDaemonService,
  stopManagedDaemonService,
  uninstallManagedDaemonService,
  getWebUiServiceStatus,
  installWebUiService,
  restartWebUiService,
  restartWebUiServiceIfInstalled,
  startWebUiService,
  stopWebUiService,
  uninstallWebUiService,
  type ManagedDaemonServiceInfo,
  type ManagedDaemonServiceStatus,
  type ManagedServicePlatform,
  type WebUiServiceInfo,
  type WebUiServiceOptions,
  type WebUiServiceStatus,
} from './service.js';
export {
  resolveWebUiTailscaleUrl,
  syncWebUiTailscaleServe,
  type SyncWebUiTailscaleServeInput,
} from './tailscale-serve.js';
export {
  ensureActiveWebUiRelease,
  getWebUiDeploymentSummary,
  type WebUiDeploymentSummary,
  type WebUiReleaseSummary,
} from './web-ui-deploy.js';
