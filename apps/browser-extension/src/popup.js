const extension = globalThis.PersonalAgentBrowserExtension;

const hostStatus = document.getElementById('popup-host-status');
const warningBox = document.getElementById('popup-warning');
const successBox = document.getElementById('popup-success');
const form = document.getElementById('popup-form');
const titleInput = document.getElementById('popup-title');
const urlInput = document.getElementById('popup-url');
const directoryInput = document.getElementById('popup-directory');
const saveButton = document.getElementById('popup-save');
const optionsButton = document.getElementById('popup-options');

function showWarning(message) {
  warningBox.hidden = !message;
  warningBox.textContent = message || '';
}

function showSuccess(message) {
  successBox.hidden = !message;
  successBox.textContent = message || '';
}

async function loadPopupState() {
  const config = await extension.getSavedConfig();
  const tab = await extension.queryActiveTab();
  const activeUrl = String(tab?.url ?? '').trim();
  const activeTitle = String(tab?.title ?? '').trim();

  titleInput.value = activeTitle || titleInput.value;
  if (extension.isHttpUrl(activeUrl)) {
    urlInput.value = activeUrl;
  }
  directoryInput.value = config.defaultDirectoryId || '';

  if (extension.isConfigured(config)) {
    const hostLabel = config.hostLabel || config.baseUrl;
    hostStatus.textContent = `${hostLabel} · default folder ${config.defaultDirectoryId || 'vault root'}`;
    showWarning('');
  } else {
    hostStatus.textContent = 'Not connected';
    showWarning('Open Options, pair the extension with a Personal Agent host, then try again.');
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  showWarning('');
  showSuccess('');
  saveButton.disabled = true;
  saveButton.textContent = 'Saving…';

  try {
    const result = await extension.importUrlToKnowledge({
      title: titleInput.value,
      url: urlInput.value,
      directoryId: directoryInput.value,
      sourceApp: extension.buildSourceAppLabel(),
    });
    const noteId = typeof result?.note?.id === 'string' && result.note.id.trim()
      ? result.note.id.trim()
      : 'saved note';
    showSuccess(`Saved to ${noteId}.`);
  } catch (error) {
    showWarning(error instanceof Error ? error.message : String(error));
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Save to vault';
  }
}

optionsButton.addEventListener('click', () => {
  void extension.openOptionsPage();
});

form.addEventListener('submit', (event) => {
  void handleSubmit(event);
});

document.addEventListener('DOMContentLoaded', () => {
  void loadPopupState().catch((error) => {
    showWarning(error instanceof Error ? error.message : String(error));
  });
});
