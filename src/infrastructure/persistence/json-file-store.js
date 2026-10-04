import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Penyimpanan array JSON dalam satu file: tulis atomik (tmp + rename) dan berurutan. */
export class JsonFileStore {
  #queue = Promise.resolve();

  constructor(file) { this.file = file; }

  async read() {
    try {
      return JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  write(items) {
    const data = JSON.stringify(items, null, 2);
    const run = this.#queue.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    this.#queue = run.catch(() => {});
    return run;
  }
}
