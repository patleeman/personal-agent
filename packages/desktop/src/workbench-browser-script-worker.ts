import { parentPort } from 'node:worker_threads';
import vm from 'node:vm';

const MAX_LOGS = 200;
const MAX_LOG_LENGTH = 2_000;
const MAX_RESULT_LENGTH = 200_000;

if (!parentPort) {
  throw new Error('browser script worker requires a parent port');
}

type RpcRequest = {
  id: number;
  op: string;
  args: unknown[];
};

type RpcResponse = {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
};

let nextRpcId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const logs: string[] = [];

function serializeLogValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendLog(values: unknown[]): void {
  const line = values.map(serializeLogValue).join(' ').slice(0, MAX_LOG_LENGTH);
  logs.push(line);
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
}

function ensureSerializable(value: unknown): unknown {
  const json = JSON.stringify(value ?? null);
  if (json.length > MAX_RESULT_LENGTH) {
    throw new Error(`Browser script result is too large (${json.length} bytes).`);
  }
  return JSON.parse(json);
}

function rpc(op: string, args: unknown[] = []): Promise<unknown> {
  const id = nextRpcId++;
  parentPort!.postMessage({ type: 'rpc', request: { id, op, args } satisfies RpcRequest });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

const browser = Object.freeze({
  goto: (url: string) => rpc('goto', [url]),
  reload: () => rpc('reload'),
  back: () => rpc('back'),
  forward: () => rpc('forward'),
  url: () => rpc('url'),
  title: () => rpc('title'),
  snapshot: () => rpc('snapshot'),
  screenshot: () => rpc('screenshot'),
  text: (selectorOrRef?: string) => rpc('text', selectorOrRef === undefined ? [] : [selectorOrRef]),
  html: (selectorOrRef?: string) => rpc('html', selectorOrRef === undefined ? [] : [selectorOrRef]),
  exists: (selectorOrRef: string) => rpc('exists', [selectorOrRef]),
  query: (selectorOrRef: string) => rpc('query', [selectorOrRef]),
  click: (selectorOrRef: string) => rpc('click', [selectorOrRef]),
  type: (selectorOrRef: string, text: string) => rpc('type', [selectorOrRef, text]),
  press: (key: string) => rpc('press', [key]),
  scroll: (x: number, y: number) => rpc('scroll', [x, y]),
  select: (selectorOrRef: string, value: string) => rpc('select', [selectorOrRef, value]),
  check: (selectorOrRef: string) => rpc('check', [selectorOrRef]),
  uncheck: (selectorOrRef: string) => rpc('uncheck', [selectorOrRef]),
  setInputFiles: (selectorOrRef: string, paths: string[]) => rpc('setInputFiles', [selectorOrRef, paths]),
  wait: (ms: number) => rpc('wait', [ms]),
  waitFor: (selectorOrRef: string) => rpc('waitFor', [selectorOrRef]),
  waitForText: (text: string) => rpc('waitForText', [text]),
  waitForLoadState: (state?: string) => rpc('waitForLoadState', state === undefined ? [] : [state]),
  evaluate: (fnOrSource: string | ((...args: unknown[]) => unknown), ...args: unknown[]) => rpc('evaluate', [typeof fnOrSource === 'function' ? fnOrSource.toString() : fnOrSource, ...args]),
  log: (...values: unknown[]) => appendLog(values),
});

const consoleProxy = Object.freeze({
  log: (...values: unknown[]) => appendLog(values),
  info: (...values: unknown[]) => appendLog(values),
  warn: (...values: unknown[]) => appendLog(values),
  error: (...values: unknown[]) => appendLog(values),
});

async function runScript(source: string): Promise<void> {
  const context = vm.createContext({
    browser,
    console: consoleProxy,
    setTimeout,
    clearTimeout,
    Promise,
  }, {
    name: 'workbench-browser-script',
    codeGeneration: { strings: false, wasm: false },
  });

  const wrapped = `(async () => {\n${source}\n})()`;
  const script = new vm.Script(wrapped, { filename: 'workbench-browser-script.js' });
  const result = await script.runInContext(context, { timeout: 1_000, breakOnSigint: false });
  parentPort!.postMessage({ type: 'done', result: ensureSerializable(result), logs });
}

parentPort.on('message', (message: unknown) => {
  const value = message as { type?: string; response?: RpcResponse; script?: string };
  if (value.type === 'start' && typeof value.script === 'string') {
    void runScript(value.script).catch((error) => {
      parentPort!.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error), logs });
    });
    return;
  }

  if (value.type === 'rpc-response' && value.response) {
    const pendingEntry = pending.get(value.response.id);
    if (!pendingEntry) {
      return;
    }
    pending.delete(value.response.id);
    if (value.response.ok) {
      pendingEntry.resolve(value.response.value);
    } else {
      pendingEntry.reject(new Error(value.response.error || 'Browser operation failed.'));
    }
  }
});
