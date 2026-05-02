import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface ReadStoredStateOptions<T> {
  key: string | null;
  fallback: T;
  storage?: StorageLike | null;
  deserialize?: (raw: string) => T;
}

interface PersistStoredStateOptions<T> {
  key: string | null;
  value: T;
  storage?: StorageLike | null;
  serialize?: (value: T) => string;
  shouldPersist?: (value: T) => boolean;
}

interface UseReloadStateOptions<T> {
  storageKey: string | null;
  initialValue: T;
  storage?: StorageLike | null;
  serialize?: (value: T) => string;
  deserialize?: (raw: string) => T;
  shouldPersist?: (value: T) => boolean;
}

export function getSessionStorage(): StorageLike | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStoredState<T>({
  key,
  fallback,
  storage = getSessionStorage(),
  deserialize = (raw) => JSON.parse(raw) as T,
}: ReadStoredStateOptions<T>): T {
  if (!storage || !key) {
    return fallback;
  }

  try {
    const raw = storage.getItem(key);
    if (raw !== null) {
      return deserialize(raw);
    }
  } catch {
    // Ignore malformed or unavailable storage.
  }

  return fallback;
}

export function persistStoredState<T>({
  key,
  value,
  storage = getSessionStorage(),
  serialize = (next) => JSON.stringify(next),
  shouldPersist = () => true,
}: PersistStoredStateOptions<T>): void {
  if (!storage || !key) {
    return;
  }

  try {
    if (!shouldPersist(value)) {
      storage.removeItem(key);
      return;
    }

    storage.setItem(key, serialize(value));
  } catch {
    // Ignore storage write failures.
  }
}

export function clearStoredState(storage: StorageLike | null | undefined, key: string | null): void {
  if (!storage || !key) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage write failures.
  }
}

export function useReloadState<T>({
  storageKey,
  initialValue,
  storage = getSessionStorage(),
  serialize,
  deserialize,
  shouldPersist,
}: UseReloadStateOptions<T>) {
  const [state, setState] = useState<T>(() =>
    readStoredState({
      key: storageKey,
      fallback: initialValue,
      storage,
      deserialize,
    }),
  );
  const hydratedKeyRef = useRef(storageKey);

  useLayoutEffect(() => {
    hydratedKeyRef.current = storageKey;
    setState(
      readStoredState({
        key: storageKey,
        fallback: initialValue,
        storage,
        deserialize,
      }),
    );
  }, [storageKey, initialValue, storage, deserialize]);

  useEffect(() => {
    if (hydratedKeyRef.current !== storageKey) {
      return;
    }

    persistStoredState({
      key: storageKey,
      value: state,
      storage,
      serialize,
      shouldPersist,
    });
  }, [storageKey, state, storage, serialize, shouldPersist]);

  const clear = useCallback(() => {
    clearStoredState(storage, storageKey);
    setState(initialValue);
  }, [storage, storageKey, initialValue]);

  return [state, setState, clear] as const;
}
