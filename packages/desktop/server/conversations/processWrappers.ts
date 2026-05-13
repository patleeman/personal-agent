export interface BashProcessWrapperContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type BashProcessWrapper = (context: BashProcessWrapperContext) => BashProcessWrapperContext;

interface RegisteredBashProcessWrapper {
  id: string;
  wrap: BashProcessWrapper;
}

const bashProcessWrappers = new Map<string, RegisteredBashProcessWrapper>();

export function registerBashProcessWrapper(id: string, wrap: BashProcessWrapper): void {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new Error('Process wrapper id is required.');
  }
  bashProcessWrappers.set(normalizedId, { id: normalizedId, wrap });
}

export function listBashProcessWrappers(): RegisteredBashProcessWrapper[] {
  return [...bashProcessWrappers.values()];
}

export function clearBashProcessWrappers(): void {
  bashProcessWrappers.clear();
}

export function applyBashProcessWrappers(context: BashProcessWrapperContext): BashProcessWrapperContext {
  return listBashProcessWrappers().reduce((current, wrapper) => wrapper.wrap(current), context);
}
