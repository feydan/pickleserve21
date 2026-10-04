import { describe, expect, it } from 'vitest';
import { addBall, createSession, type Session } from './model';
import { CURRENT_KEY, HISTORY_KEY, createStore } from './storage';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

class ThrowingStorage {
  getItem(): string | null {
    throw new Error('SecurityError');
  }
  setItem(): void {
    throw new Error('SecurityError');
  }
  removeItem(): void {
    throw new Error('SecurityError');
  }
}

/** Reads fine but every write fails (e.g. quota exceeded). */
class QuotaStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error('QuotaExceededError');
  }
}

const NOW = new Date('2026-10-01T12:00:00Z');

function sample(id = 'a'): Session {
  return addBall(addBall(createSession({ name: 'Pat' }, NOW, id), 5), 3);
}

describe('storage round trip', () => {
  it('saves and loads history and current session', () => {
    const backend = new MemoryStorage();
    const store = createStore(backend);
    store.saveHistory([sample('a'), sample('b')]);
    store.saveCurrent(sample('c'));

    const reopened = createStore(backend);
    expect(reopened.loadHistory().map((s) => s.id)).toEqual(['a', 'b']);
    expect(reopened.loadCurrent()?.id).toBe('c');
    expect(reopened.persistent).toBe(true);
  });

  it('clears the current session with null', () => {
    const backend = new MemoryStorage();
    const store = createStore(backend);
    store.saveCurrent(sample());
    store.saveCurrent(null);
    expect(backend.getItem(CURRENT_KEY)).toBeNull();
    expect(store.loadCurrent()).toBeNull();
  });

  it('returns empty values when nothing is stored', () => {
    const store = createStore(new MemoryStorage());
    expect(store.loadHistory()).toEqual([]);
    expect(store.loadCurrent()).toBeNull();
  });
});

describe('invalid stored data', () => {
  it('ignores corrupt JSON', () => {
    const backend = new MemoryStorage();
    backend.setItem(HISTORY_KEY, '{not json');
    backend.setItem(CURRENT_KEY, '[[[');
    const store = createStore(backend);
    expect(store.loadHistory()).toEqual([]);
    expect(store.loadCurrent()).toBeNull();
  });

  it('ignores valid JSON of the wrong shape', () => {
    const backend = new MemoryStorage();
    backend.setItem(HISTORY_KEY, JSON.stringify({ sessions: [] }));
    backend.setItem(CURRENT_KEY, JSON.stringify({ id: 1 }));
    const store = createStore(backend);
    expect(store.loadHistory()).toEqual([]);
    expect(store.loadCurrent()).toBeNull();
  });

  it('drops invalid entries but keeps valid ones', () => {
    const backend = new MemoryStorage();
    backend.setItem(HISTORY_KEY, JSON.stringify([sample('ok'), { id: 'bad' }, 42, null]));
    expect(createStore(backend).loadHistory().map((s) => s.id)).toEqual(['ok']);
  });

  it('does not read data stored under another version key', () => {
    const backend = new MemoryStorage();
    backend.setItem('ps21.history.v0', JSON.stringify([sample()]));
    backend.setItem('ps21.current.v2', JSON.stringify(sample()));
    const store = createStore(backend);
    expect(store.loadHistory()).toEqual([]);
    expect(store.loadCurrent()).toBeNull();
  });

  it('recomputes totals from the stored balls', () => {
    const backend = new MemoryStorage();
    const tampered = { ...sample(), trials: [{ balls: [5, 3], total: 999 }] };
    backend.setItem(CURRENT_KEY, JSON.stringify(tampered));
    expect(createStore(backend).loadCurrent()?.trials[0]?.total).toBe(8);
  });
});

describe('in-memory fallback', () => {
  it('works with no storage at all', () => {
    const store = createStore(null);
    expect(store.persistent).toBe(false);
    store.saveHistory([sample('a')]);
    store.saveCurrent(sample('b'));
    expect(store.loadHistory().map((s) => s.id)).toEqual(['a']);
    expect(store.loadCurrent()?.id).toBe('b');
  });

  it('falls back to memory when storage throws on read', () => {
    const store = createStore(new ThrowingStorage());
    expect(store.loadHistory()).toEqual([]);
    expect(store.persistent).toBe(false);
    store.saveHistory([sample('a')]);
    expect(store.loadHistory().map((s) => s.id)).toEqual(['a']);
  });

  it('falls back to memory when storage throws on write', () => {
    const store = createStore(new ThrowingStorage());
    expect(() => store.saveCurrent(sample('x'))).not.toThrow();
    expect(store.persistent).toBe(false);
    expect(store.loadCurrent()?.id).toBe('x');
    expect(() => store.saveCurrent(null)).not.toThrow();
    expect(store.loadCurrent()).toBeNull();
  });

  it('keeps the latest data in memory after a quota error', () => {
    const backend = new QuotaStorage();
    const store = createStore(backend);
    store.saveHistory([sample('a'), sample('b')]);
    expect(store.persistent).toBe(false);
    expect(store.loadHistory().map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('uses memory when the localStorage accessor itself throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      const store = createStore();
      expect(store.persistent).toBe(false);
      store.saveCurrent(sample('m'));
      expect(store.loadCurrent()?.id).toBe('m');
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('external changes', () => {
  function storageEvent(key: string | null): Event {
    return Object.assign(new Event('storage'), { key });
  }

  it('reports changes to its own keys only', () => {
    const events = new EventTarget();
    const store = createStore(new MemoryStorage(), events);
    const seen: string[] = [];
    store.onExternalChange((key) => seen.push(key));
    events.dispatchEvent(storageEvent(HISTORY_KEY));
    events.dispatchEvent(storageEvent(CURRENT_KEY));
    events.dispatchEvent(storageEvent('something.else'));
    expect(seen).toEqual([HISTORY_KEY, CURRENT_KEY]);
  });

  it('reports both keys when storage is cleared', () => {
    const events = new EventTarget();
    const store = createStore(new MemoryStorage(), events);
    const seen: string[] = [];
    store.onExternalChange((key) => seen.push(key));
    events.dispatchEvent(storageEvent(null));
    expect(seen).toEqual([HISTORY_KEY, CURRENT_KEY]);
  });

  it('ignores external changes once it has fallen back to memory', () => {
    const events = new EventTarget();
    const store = createStore(new ThrowingStorage(), events);
    store.loadHistory();
    const seen: string[] = [];
    store.onExternalChange((key) => seen.push(key));
    events.dispatchEvent(storageEvent(HISTORY_KEY));
    expect(seen).toEqual([]);
  });
});
