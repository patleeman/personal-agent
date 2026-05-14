type AppEventsModule = typeof import('../../shared/appEvents.js');

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

async function importAppEvents(): Promise<AppEventsModule> {
  return dynamicImport<AppEventsModule>('../../shared/appEvents.js');
}

export async function publishAppEvent(...args: Parameters<AppEventsModule['publishAppEvent']>) {
  const module = await importAppEvents();
  return module.publishAppEvent(...args);
}

export async function invalidateAppTopics(...args: Parameters<AppEventsModule['invalidateAppTopics']>) {
  const module = await importAppEvents();
  return module.invalidateAppTopics(...args);
}
