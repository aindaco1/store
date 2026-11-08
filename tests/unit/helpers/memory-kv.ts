export class MemoryKV {
  store = new Map<string, string>();
  async get(key: string, options?: { type?: string }) {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return options?.type === 'json' ? JSON.parse(value) : value;
  }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list({ prefix = '', limit = 1000 } = {}) {
    const keys = [...this.store.keys()].filter((key) => key.startsWith(prefix)).sort().slice(0, limit);
    return { keys: keys.map((name) => ({ name })), list_complete: true };
  }
}
