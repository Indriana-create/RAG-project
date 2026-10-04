import { createAdminUser } from '../../domain/admin-user.js';
import { ConflictError } from '../../domain/errors.js';
import { JsonFileStore } from './json-file-store.js';

/** Adapter AdminUserRepository: satu file JSON (mode tanpa database). */
export class JsonFileAdminUserRepository {
  #store;
  #users = null;

  constructor(file) { this.#store = new JsonFileStore(file); }

  async #load() {
    this.#users ??= new Map((await this.#store.read()).map((u) => [u.id, createAdminUser(u)]));
    return this.#users;
  }

  async list() { return [...(await this.#load()).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async get(id) { return (await this.#load()).get(id); }
  async getByUsername(username) { return [...(await this.#load()).values()].find((u) => u.username === username); }

  async save(user) {
    const users = await this.#load();
    const clash = [...users.values()].find((u) => u.username === user.username && u.id !== user.id);
    if (clash) throw new ConflictError(`Username "${user.username}" sudah dipakai`);
    users.set(user.id, user);
    await this.#store.write([...users.values()]);
  }

  async delete(id) {
    const users = await this.#load();
    const existed = users.delete(id);
    if (existed) await this.#store.write([...users.values()]);
    return existed;
  }
}
