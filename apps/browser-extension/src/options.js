const extension = globalThis.PersonalAgentBrowserExtension;

const statusBox = document.getElementById('options-status');
const setupUrlInput = document.getElementById('options-setup-url');
const baseUrlInput = document.getElementById('options-base-url');
const pairingCodeInput = document.getElementById('options-pairing-code');
const deviceLabelInput = document.getElementById('options-device-label');
const defaultDirectoryInput = document.getElementById('options-default-directory');
const connectForm = document.getElementById('options-connect-form');
const defaultsForm = document.getElementById('options-defaults-form');
const connectButton = document.getElementById('options-connect-button');
const disconnectButton = document.getElementById('options-disconnect-button');
const currentHost = document.getElementById('options-current-host');
const currentBaseUrl = document.getElementById('options-current-base-url');
const currentDirectory = document.getElementById('options-current-directory');
const currentPairedAt = document.getElementById('options-current-paired-at');

function setStatus(message, tone = 'info') {
  statusBox.hidden = !message;
  statusBox.textContent = message || '';
  statusBox.className = `pa-extension-callout ${tone ? `pa-extension-callout-${tone}` : ''}`.trim();
}

function renderConfig(config) {
  baseUrlInput.value = config.baseUrl || '';
  deviceLabelInput.value = config.deviceLabel || extension.buildDefaultDeviceLabel();
  defaultDirectoryInput.value = config.defaultDirectoryId || '';
  currentHost.textContent = config.hostLabel || (extension.isConfigured(config) ? config.baseUrl : 'Not connected');
  currentBaseUrl.textContent = config.baseUrl || '—';
  currentDirectory.textContent = config.defaultDirectoryId || 'vault root';
  currentPairedAt.textContent = config.pairedAt ? new Date(config.pairedAt).toLocaleString() : '—';
  disconnectButton.disabled = !extension.isConfigured(config);
}

async function refreshConfig() {
  const config = await extension.getSavedConfig();
  renderConfig(config);
}

async function handleConnect(event) {
  event.preventDefault();
  setStatus('', 'info');
  connectButton.disabled = true;
  connectButton.textContent = 'Pairing…';

  try {
    const config = await extension.pairAndStore({
      setupUrl: setupUrlInput.value,
      baseUrl: baseUrlInput.value,
      pairingCode: pairingCodeInput.value,
      deviceLabel: deviceLabelInput.value,
      defaultDirectoryId: defaultDirectoryInput.value,
    });
    pairingCodeInput.value = '';
    setupUrlInput.value = '';
    renderConfig(config);
    setStatus(`Connected to ${config.hostLabel || config.baseUrl}.`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'warning');
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = 'Pair extension';
  }
}

async function handleSaveDefaults(event) {
  event.preventDefault();
  try {
    const config = await extension.saveDefaultSettings({
      defaultDirectoryId: defaultDirectoryInput.value,
    });
    renderConfig(config);
    setStatus('Default folder saved.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'warning');
  }
}

async function handleDisconnect() {
  try {
    const config = await extension.clearSavedConnection();
    pairingCodeInput.value = '';
    setupUrlInput.value = '';
    renderConfig(config);
    setStatus('Disconnected. Pair again to keep saving URLs.', 'warning');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'warning');
  }
}

connectForm.addEventListener('submit', (event) => {
  void handleConnect(event);
});

defaultsForm.addEventListener('submit', (event) => {
  void handleSaveDefaults(event);
});

disconnectButton.addEventListener('click', () => {
  void handleDisconnect();
});

document.addEventListener('DOMContentLoaded', () => {
  void refreshConfig().catch((error) => {
    setStatus(error instanceof Error ? error.message : String(error), 'warning');
  });
});
