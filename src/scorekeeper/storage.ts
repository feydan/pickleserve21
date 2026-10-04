// Safe localStorage wrapper. Every access is guarded; if storage is missing,
// blocked or throws, the store silently falls back to in-memory data.

import { isSession, normalizeSession, type Session } from './model';

export const HISTORY_KEY = 'ps21.history.v1';
export const CURRENT_KEY = 'ps21.current.v1';
export const HISTORY_LIMIT = 200;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type EventSource = Pick<EventTarget, 'addEventListener'>;
export type StoreKey = typeof HISTORY_KEY | typeof CURRENT_KEY;

export interface ScoreStore {
  loadHistory(): Session[];
  saveHistory(history: Session[]): void;
  loadCurrent(): Session | null;
  saveCurrent(session: Session | null): void;
  /** True while values are actually being persisted to the backend. */
  readonly persistent: boolean;
  /** Calls back when another tab changes a stored value. */
  onExternalChange(listener: (key: StoreKey) => void): void;
}

function defaultBackend(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function defaultEvents(): EventSource | null {
  return typeof globalThis.addEventListener === 'function' ? globalThis : null;
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function createStore(
  backend: StorageLike | null | undefined = defaultBackend(),
  events: EventSource | null = defaultEvents(),
): ScoreStore {
  let store: StorageLike | null = backend ?? null;
  const memory = new Map<string, string>();

  function read(key: string): string | null {
    if (store) {
      try {
        return store.getItem(key);
      } catch {
        store = null;
      }
    }
    return memory.get(key) ?? null;
  }

  function write(key: string, value: string | null): void {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
    if (!store) return;
    try {
      if (value === null) store.removeItem(key);
      else store.setItem(key, value);
    } catch {
      // Quota exceeded or access revoked: keep going in memory.
      store = null;
    }
  }

  return {
    get persistent() {
      return store !== null;
    },
    loadHistory() {
      const data = parse(read(HISTORY_KEY));
      if (!Array.isArray(data)) return [];
      return data.filter(isSession).map(normalizeSession);
    },
    saveHistory(history) {
      write(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
    },
    loadCurrent() {
      const data = parse(read(CURRENT_KEY));
      return isSession(data) ? normalizeSession(data) : null;
    },
    saveCurrent(session) {
      write(CURRENT_KEY, session ? JSON.stringify(session) : null);
    },
    onExternalChange(listener) {
      // The browser fires `storage` only in the *other* tabs of the same origin.
      // A null key means the whole storage was cleared.
      events?.addEventListener('storage', (e) => {
        if (!store) return;
        const key = (e as StorageEvent).key;
        if (key === null || key === HISTORY_KEY) listener(HISTORY_KEY);
        if (key === null || key === CURRENT_KEY) listener(CURRENT_KEY);
      });
    },
  };
}
