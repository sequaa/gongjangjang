import "@testing-library/jest-dom/vitest";

// Node 26 + jsdom 25: neither the bare `localStorage` global nor
// `window.localStorage` is wired up (Node's own experimental localStorage
// global shadows jsdom's and is undefined without --localstorage-file). The
// dashboard's auth token store relies on localStorage, so provide a minimal
// in-memory Storage polyfill for every test.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

if (typeof globalThis.localStorage === "undefined" || globalThis.localStorage === null) {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  }
}
