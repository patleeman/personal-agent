import type { ConversationBootstrapState } from '../shared/types';

interface PersistedConversationBootstrapEntry {
  key: string;
  data: ConversationBootstrapState;
  versionKey: string;
  updatedAt: number;
}

const CONVERSATION_BOOTSTRAP_DB_NAME = 'pa-web-cache';
const CONVERSATION_BOOTSTRAP_DB_VERSION = 1;
const CONVERSATION_BOOTSTRAP_STORE = 'conversation-bootstrap';
const MAX_PERSISTED_CONVERSATION_BOOTSTRAPS = 24;

let conversationBootstrapDbPromise: Promise<IDBDatabase | null> | null = null;

function buildConversationBootstrapCacheKey(
  conversationId: string,
  options?: { tailBlocks?: number },
): string {
  return `${conversationId}::${options?.tailBlocks ?? 'all'}`;
}

function supportsConversationBootstrapPersistence(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

async function openConversationBootstrapDb(): Promise<IDBDatabase | null> {
  if (!supportsConversationBootstrapPersistence()) {
    return null;
  }

  if (!conversationBootstrapDbPromise) {
    conversationBootstrapDbPromise = new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(CONVERSATION_BOOTSTRAP_DB_NAME, CONVERSATION_BOOTSTRAP_DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(CONVERSATION_BOOTSTRAP_STORE)) {
            db.createObjectStore(CONVERSATION_BOOTSTRAP_STORE, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          conversationBootstrapDbPromise = null;
          resolve(null);
        };
        request.onblocked = () => resolve(null);
      } catch {
        conversationBootstrapDbPromise = null;
        resolve(null);
      }
    });
  }

  return conversationBootstrapDbPromise;
}

export async function readPersistedConversationBootstrapEntry(
  conversationId: string,
  options?: { tailBlocks?: number },
): Promise<{ data: ConversationBootstrapState; versionKey: string } | null> {
  const db = await openConversationBootstrapDb();
  if (!db) {
    return null;
  }

  try {
    const tx = db.transaction(CONVERSATION_BOOTSTRAP_STORE, 'readonly');
    const store = tx.objectStore(CONVERSATION_BOOTSTRAP_STORE);
    const record = await requestToPromise(store.get(buildConversationBootstrapCacheKey(conversationId, options)));
    await transactionComplete(tx).catch(() => undefined);
    if (!record || typeof record !== 'object') {
      return null;
    }

    const entry = record as Partial<PersistedConversationBootstrapEntry>;
    if (!entry.data || typeof entry.versionKey !== 'string') {
      return null;
    }

    return {
      data: entry.data,
      versionKey: entry.versionKey,
    };
  } catch {
    return null;
  }
}

async function trimPersistedConversationBootstrapEntries(): Promise<void> {
  const db = await openConversationBootstrapDb();
  if (!db) {
    return;
  }

  try {
    const tx = db.transaction(CONVERSATION_BOOTSTRAP_STORE, 'readwrite');
    const store = tx.objectStore(CONVERSATION_BOOTSTRAP_STORE);
    const records = await requestToPromise(store.getAll()) as PersistedConversationBootstrapEntry[];
    if (records.length > MAX_PERSISTED_CONVERSATION_BOOTSTRAPS) {
      records
        .slice()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(MAX_PERSISTED_CONVERSATION_BOOTSTRAPS)
        .forEach((record) => {
          if (typeof record.key === 'string' && record.key.length > 0) {
            store.delete(record.key);
          }
        });
    }
    await transactionComplete(tx);
  } catch {
    // Ignore persistence trim failures.
  }
}

export async function writePersistedConversationBootstrapEntry(
  conversationId: string,
  data: ConversationBootstrapState,
  options?: { tailBlocks?: number },
  versionKey = '0',
): Promise<void> {
  const db = await openConversationBootstrapDb();
  if (!db) {
    return;
  }

  try {
    const tx = db.transaction(CONVERSATION_BOOTSTRAP_STORE, 'readwrite');
    const store = tx.objectStore(CONVERSATION_BOOTSTRAP_STORE);
    store.put({
      key: buildConversationBootstrapCacheKey(conversationId, options),
      data,
      versionKey,
      updatedAt: Date.now(),
    } satisfies PersistedConversationBootstrapEntry);
    await transactionComplete(tx);
  } catch {
    return;
  }

  void trimPersistedConversationBootstrapEntries();
}
