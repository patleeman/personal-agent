(function initPersonalAgentBrowserExtension(global) {
  const promiseApi = typeof global.browser !== 'undefined' && global.browser?.runtime?.id
    ? global.browser
    : null;
  const callbackApi = promiseApi ? null : global.chrome;
  const api = promiseApi ?? callbackApi;

  const CONFIG_DEFAULTS = {
    baseUrl: '',
    bearerToken: '',
    defaultDirectoryId: '',
    hostLabel: '',
    deviceLabel: '',
    pairedAt: '',
  };

  function readRuntimeError() {
    return callbackApi?.runtime?.lastError?.message ?? '';
  }

  function callWithCallback(target, methodName, ...args) {
    return new Promise((resolve, reject) => {
      target[methodName](...args, (result) => {
        const message = readRuntimeError();
        if (message) {
          reject(new Error(message));
          return;
        }
        resolve(result);
      });
    });
  }

  function normalizeDirectoryId(value) {
    return String(value ?? '').trim().replace(/^\/+|\/+$/g, '');
  }

  function withDefaultScheme(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) {
      return '';
    }

    return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)
      ? trimmed
      : `http://${trimmed}`;
  }

  function normalizeCompanionBaseUrl(value) {
    const normalizedInput = withDefaultScheme(value);
    if (!normalizedInput) {
      throw new Error('Base URL is required.');
    }

    const parsed = new URL(normalizedInput);
    let pathname = parsed.pathname.replace(/\/+$/g, '');

    for (const suffix of ['/companion/v1', '/v1', '/companion']) {
      if (pathname === suffix) {
        pathname = '';
        break;
      }
      if (pathname.endsWith(suffix)) {
        pathname = pathname.slice(0, -suffix.length);
        break;
      }
    }

    return `${parsed.origin}${pathname}`;
  }

  function buildCompanionApiRoot(baseUrl) {
    return `${normalizeCompanionBaseUrl(baseUrl)}/companion/v1`;
  }

  function parseSetupUrl(input) {
    const raw = String(input ?? '').trim();
    if (!raw) {
      return null;
    }

    const parsed = new URL(raw);
    const route = `${parsed.host}${parsed.pathname}`.replace(/\/$/g, '');
    if (parsed.protocol !== 'pa-companion:' || (route !== 'pair' && route !== '/pair')) {
      throw new Error('Setup URL must use the pa-companion://pair format.');
    }

    const base = parsed.searchParams.get('base')?.trim() ?? '';
    const code = parsed.searchParams.get('code')?.trim() ?? '';
    if (!base || !code) {
      throw new Error('Setup URL is missing the base host URL or pairing code.');
    }

    return {
      baseUrl: normalizeCompanionBaseUrl(base),
      pairingCode: code,
    };
  }

  function isHttpUrl(value) {
    try {
      const parsed = new URL(String(value ?? '').trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function buildBrowserName() {
    const userAgent = global.navigator?.userAgent ?? '';
    if (userAgent.includes('Firefox/')) {
      return 'Firefox';
    }
    if (userAgent.includes('Edg/')) {
      return 'Edge';
    }
    if (userAgent.includes('Chrome/')) {
      return 'Chrome';
    }
    if (userAgent.includes('Safari/')) {
      return 'Safari';
    }
    return 'Browser';
  }

  function buildSourceAppLabel() {
    return `Personal Agent ${buildBrowserName()} Extension`;
  }

  function buildDefaultDeviceLabel() {
    return buildSourceAppLabel();
  }

  async function storageGet(keys) {
    if (promiseApi) {
      return promiseApi.storage.local.get(keys);
    }
    return callWithCallback(callbackApi.storage.local, 'get', keys);
  }

  async function storageSet(value) {
    if (promiseApi) {
      await promiseApi.storage.local.set(value);
      return;
    }
    await callWithCallback(callbackApi.storage.local, 'set', value);
  }

  async function storageRemove(keys) {
    if (promiseApi) {
      await promiseApi.storage.local.remove(keys);
      return;
    }
    await callWithCallback(callbackApi.storage.local, 'remove', keys);
  }

  async function getSavedConfig() {
    const loaded = await storageGet(CONFIG_DEFAULTS);
    return {
      ...CONFIG_DEFAULTS,
      ...loaded,
      defaultDirectoryId: normalizeDirectoryId(loaded.defaultDirectoryId ?? ''),
    };
  }

  function isConfigured(config) {
    return Boolean(config.baseUrl && config.bearerToken);
  }

  async function saveDefaultSettings(input) {
    const nextDirectoryId = normalizeDirectoryId(input?.defaultDirectoryId ?? '');
    const current = await getSavedConfig();
    const next = {
      ...current,
      defaultDirectoryId: nextDirectoryId,
    };
    await storageSet(next);
    return next;
  }

  async function clearSavedConnection() {
    const current = await getSavedConfig();
    const next = {
      ...CONFIG_DEFAULTS,
      defaultDirectoryId: current.defaultDirectoryId,
    };
    await storageRemove(['baseUrl', 'bearerToken', 'hostLabel', 'deviceLabel', 'pairedAt']);
    await storageSet(next);
    return next;
  }

  async function fetchCompanionJson(input) {
    const response = await fetch(input.url, {
      method: input.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(input.body ? { 'Content-Type': 'application/json' } : {}),
        ...(input.bearerToken ? { Authorization: `Bearer ${input.bearerToken}` } : {}),
      },
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      credentials: 'omit',
      cache: 'no-store',
    });

    const responseText = await response.text();
    let payload = null;
    if (responseText.trim()) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const message = payload && typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : responseText.trim() || `${response.status} ${response.statusText}`.trim();
      throw new Error(message);
    }

    return payload;
  }

  async function pairAndStore(input) {
    const setup = input.setupUrl ? parseSetupUrl(input.setupUrl) : null;
    const baseUrl = setup?.baseUrl ?? normalizeCompanionBaseUrl(input.baseUrl);
    const pairingCode = setup?.pairingCode ?? String(input.pairingCode ?? '').trim();
    const deviceLabel = String(input.deviceLabel ?? '').trim() || buildDefaultDeviceLabel();
    const defaultDirectoryId = normalizeDirectoryId(input.defaultDirectoryId ?? '');

    if (!pairingCode) {
      throw new Error('Pairing code is required.');
    }

    const apiRoot = buildCompanionApiRoot(baseUrl);
    const paired = await fetchCompanionJson({
      url: `${apiRoot}/auth/pair`,
      method: 'POST',
      body: {
        code: pairingCode,
        deviceLabel,
      },
    });

    const next = {
      baseUrl,
      bearerToken: String(paired?.bearerToken ?? '').trim(),
      defaultDirectoryId,
      hostLabel: String(paired?.hello?.hostLabel ?? '').trim(),
      deviceLabel,
      pairedAt: new Date().toISOString(),
    };

    if (!next.bearerToken) {
      throw new Error('Pairing succeeded but no bearer token was returned.');
    }

    await storageSet(next);
    return next;
  }

  async function importUrlToKnowledge(input) {
    const url = String(input?.url ?? '').trim();
    if (!isHttpUrl(url)) {
      throw new Error('Enter a valid http:// or https:// URL.');
    }

    const config = await getSavedConfig();
    if (!isConfigured(config)) {
      throw new Error('Configure the extension first from the Options page.');
    }

    const response = await fetchCompanionJson({
      url: `${buildCompanionApiRoot(config.baseUrl)}/knowledge/import`,
      method: 'POST',
      bearerToken: config.bearerToken,
      body: {
        kind: 'url',
        directoryId: normalizeDirectoryId(input?.directoryId ?? config.defaultDirectoryId) || null,
        title: String(input?.title ?? '').trim() || null,
        url,
        sourceApp: String(input?.sourceApp ?? '').trim() || buildSourceAppLabel(),
      },
    });

    return response;
  }

  async function queryActiveTab() {
    if (promiseApi) {
      const tabs = await promiseApi.tabs.query({ active: true, currentWindow: true });
      return tabs[0] ?? null;
    }

    const tabs = await callWithCallback(callbackApi.tabs, 'query', { active: true, currentWindow: true });
    return tabs[0] ?? null;
  }

  async function openOptionsPage() {
    if (promiseApi) {
      await promiseApi.runtime.openOptionsPage();
      return;
    }
    await callWithCallback(callbackApi.runtime, 'openOptionsPage');
  }

  async function createContextMenu(options) {
    if (promiseApi) {
      return promiseApi.contextMenus.create(options);
    }
    return callWithCallback(callbackApi.contextMenus, 'create', options);
  }

  async function removeAllContextMenus() {
    if (promiseApi) {
      await promiseApi.contextMenus.removeAll();
      return;
    }
    await callWithCallback(callbackApi.contextMenus, 'removeAll');
  }

  async function showNotification(title, message) {
    if (!api?.notifications?.create) {
      return null;
    }

    const options = {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: String(title ?? '').trim() || 'Personal Agent',
      message: String(message ?? '').trim() || 'Done.',
    };

    if (promiseApi) {
      return promiseApi.notifications.create(options);
    }

    return callWithCallback(callbackApi.notifications, 'create', options);
  }

  global.PersonalAgentBrowserExtension = {
    api,
    CONFIG_DEFAULTS,
    clearSavedConnection,
    buildDefaultDeviceLabel,
    buildSourceAppLabel,
    createContextMenu,
    getSavedConfig,
    importUrlToKnowledge,
    isConfigured,
    isHttpUrl,
    normalizeCompanionBaseUrl,
    normalizeDirectoryId,
    openOptionsPage,
    removeAllContextMenus,
    pairAndStore,
    parseSetupUrl,
    queryActiveTab,
    saveDefaultSettings,
    showNotification,
  };
})(globalThis);
