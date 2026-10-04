import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createKnowledgeDocument } from '../../domain/knowledge-document.js';

/** Adapter KnowledgeRepository: satu file JSON, ditulis atomik (tmp + rename) dan berurutan. */
export class JsonFileKnowledgeRepository {
  #file;
  #docs = null;
  #queue = Promise.resolve();

  constructor(file) { this.#file = file; }

  async list() {
    await this.#load();
    return [...this.#docs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title));
  }

  async get(id) {
    await this.#load();
    return this.#docs.get(id);
  }

  async save(doc) {
    await this.#load();
    this.#docs.set(doc.id, doc);
    await this.#persist();
  }

  async delete(id) {
    await this.#load();
    const existed = this.#docs.delete(id);
    if (existed) await this.#persist();
    return existed;
  }

  async #load() {
    if (this.#docs) return;
    let items = [];
    try {
      items = JSON.parse(await readFile(this.#file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    this.#docs = new Map(items.map((d) => [d.id, createKnowledgeDocument(d)]));
  }

  #persist() {
    const data = JSON.stringify([...this.#docs.values()], null, 2);
    const run = this.#queue.then(async () => {
      await mkdir(path.dirname(this.#file), { recursive: true });
      const tmp = `${this.#file}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, this.#file);
    });
    this.#queue = run.catch(() => {});
    return run;
  }
}
