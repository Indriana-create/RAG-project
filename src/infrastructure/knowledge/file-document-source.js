import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Adapter DocumentSource: membaca file .md/.txt dari sebuah folder (folder tidak ada = kosong). */
export class FileDocumentSource {
  constructor(dir) { this.dir = dir; }

  async loadAll() {
    const names = await readdir(this.dir).catch((err) => { if (err.code === 'ENOENT') return []; throw err; });
    const files = names.filter((f) => /\.(md|txt)$/i.test(f)).sort();
    return Promise.all(files.map(async (file) => {
      const content = await readFile(path.join(this.dir, file), 'utf8');
      const heading = content.match(/^#\s+(.+)$/m)?.[1];
      const id = file.replace(/\.[^.]+$/, '');
      return { id, title: heading ?? id, content };
    }));
  }
}
