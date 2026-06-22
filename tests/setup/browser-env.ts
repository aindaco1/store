import { beforeEach } from 'vitest';

type StorageMap = Map<string, string>;

function createStorageShim(): Storage {
  const backingStore: StorageMap = new Map();

  return {
    get length() {
      return backingStore.size;
    },
    clear() {
      backingStore.clear();
    },
    getItem(key: string) {
      return backingStore.has(String(key)) ? backingStore.get(String(key)) ?? null : null;
    },
    key(index: number) {
      const keys = Array.from(backingStore.keys());
      return keys[index] ?? null;
    },
    removeItem(key: string) {
      backingStore.delete(String(key));
    },
    setItem(key: string, value: string) {
      backingStore.set(String(key), String(value));
    }
  } as Storage;
}

function installStorageShim(name: 'localStorage' | 'sessionStorage') {
  const browserWindow = globalThis.window as (Window & typeof globalThis) | undefined;
  const existing = browserWindow?.[name];
  const usableExisting = existing && typeof existing.clear === 'function' && typeof existing.getItem === 'function';
  const storage = usableExisting ? existing : createStorageShim();

  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: storage
  });

  if (browserWindow) {
    Object.defineProperty(browserWindow, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: storage
    });
  }
}

function syncBrowserStorageGlobals() {
  if (!globalThis.window) {
    return;
  }

  installStorageShim('localStorage');
  installStorageShim('sessionStorage');
}

syncBrowserStorageGlobals();
beforeEach(syncBrowserStorageGlobals);
