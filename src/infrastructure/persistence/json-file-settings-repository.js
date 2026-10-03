import { JsonFileStore } from './json-file-store.js';

/** Adapter SettingsRepository: satu file JSON berisi daftar {key, ...record} (mode tanpa database). */
export class JsonFileSettingsRepository {
  #store;
  #records = null;

  constructor(file) { this.#store = new JsonFileStore(file); }

  async #load() {
    this.#records ??= new Map((await this.#store.read()).map(({ key, ...record }) => [key, record]));
    return this.#records;
  }

  async get(key) { return (await this.#load()).get(key); }

  async set(key, record) {
    const records = await this.#load();
    records.set(key, record);
    await this.#store.write([...records].map(([k, v]) => ({ key: k, ...v })));
  }
}
