// Serial transactions with rollback/cloning: concurrent calls cannot share a
// mutable object, as they could in a simplistic Map mock.
export class Storage {
  data = new Map<string, any>(); alarmAt: number | null = null; queue = Promise.resolve();
  async get(key: string) { return structuredClone(this.data.get(key)); }
  async put(key: string, value: any) { this.data.set(key, structuredClone(value)); }
  async delete(keys: string | string[]) { for (const key of [keys].flat()) this.data.delete(key); }
  async getAlarm() { return this.alarmAt; }
  async setAlarm(at: number) { this.alarmAt = at; }
  async list({ prefix, limit, startAfter }: any) { return new Map([...this.data].filter(([k]) => k.startsWith(prefix) && (!startAfter || k > startAfter)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)); }
  async transaction<T>(callback: (storage: Storage) => Promise<T>) {
    const run = this.queue.then(async () => {
      const snapshot = structuredClone(this.data);
      try { return await callback(this); } catch (error) { this.data = snapshot; throw error; }
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
