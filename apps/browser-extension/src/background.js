importScripts('shared.js');

const extension = globalThis.PersonalAgentBrowserExtension;
const MENU_SAVE_PAGE = 'save-page';
const MENU_SAVE_LINK = 'save-link';

async function recreateContextMenus() {
  await extension.removeAllContextMenus();
  await extension.createContextMenu({
    id: MENU_SAVE_PAGE,
    title: 'Save page to Personal Agent',
    contexts: ['page'],
  });
  await extension.createContextMenu({
    id: MENU_SAVE_LINK,
    title: 'Save link to Personal Agent',
    contexts: ['link'],
  });
}

async function saveUrlCapture(input) {
  try {
    const result = await extension.importUrlToKnowledge({
      url: input.url,
      title: input.title,
      directoryId: input.directoryId,
      sourceApp: extension.buildSourceAppLabel(),
    });

    const noteId = typeof result?.note?.id === 'string' && result.note.id.trim()
      ? result.note.id.trim()
      : 'vault';
    await extension.showNotification('Saved to Personal Agent', `${result?.title ?? input.url} → ${noteId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await extension.showNotification('Personal Agent capture failed', message);
    if (message.includes('Configure the extension first')) {
      await extension.openOptionsPage();
    }
  }
}

async function saveActiveTab() {
  const tab = await extension.queryActiveTab();
  const url = String(tab?.url ?? '').trim();
  if (!extension.isHttpUrl(url)) {
    await extension.showNotification('Nothing to save', 'The current tab does not have a regular web URL.');
    return;
  }

  await saveUrlCapture({
    url,
    title: String(tab?.title ?? '').trim() || url,
  });
}

extension.api.runtime.onInstalled.addListener((details) => {
  void recreateContextMenus();
  if (details.reason === 'install') {
    void extension.openOptionsPage();
  }
});

extension.api.runtime.onStartup.addListener(() => {
  void recreateContextMenus();
});

extension.api.contextMenus.onClicked.addListener((info, tab) => {
  const targetUrl = info.menuItemId === MENU_SAVE_LINK
    ? String(info.linkUrl ?? '').trim()
    : String(info.pageUrl ?? tab?.url ?? '').trim();
  if (!extension.isHttpUrl(targetUrl)) {
    void extension.showNotification('Nothing to save', 'This menu item only works on regular web URLs.');
    return;
  }

  const title = info.menuItemId === MENU_SAVE_PAGE
    ? String(tab?.title ?? '').trim() || targetUrl
    : '';

  void saveUrlCapture({
    url: targetUrl,
    title,
  });
});

extension.api.commands.onCommand.addListener((command) => {
  if (command === 'save-current-page') {
    void saveActiveTab();
  }
});
