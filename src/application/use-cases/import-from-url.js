import { CRAWL_LIMITS, pickSiteLinks } from '../../domain/web-url.js';
import { LIMITS } from '../../domain/knowledge-document.js';
import { ValidationError } from '../errors.js';

const MIN_CHARS = 40;
const NO_TEXT = 'Tidak ada teks yang bisa diambil dari halaman ini. Situs yang kontennya dimuat lewat JavaScript (mis. aplikasi React/SPA) belum didukung.';

const withSource = (text, url) => `${text}\n\nSumber: ${url}`;

/** Mengambil satu halaman web (atau PDF/DOCX/PPTX di sebuah URL) menjadi teks knowledge untuk ditinjau admin. */
export class ImportKnowledgeFromUrl {
  constructor({ reader }) { this.reader = reader; }

  async execute({ url, signal }) {
    const page = await this.reader.read(url, { signal });
    if (page.text.length < MIN_CHARS) throw new ValidationError(NO_TEXT);
    if (page.text.length > LIMITS.content) {
      throw new ValidationError(`Teks halaman ${page.text.length.toLocaleString('id-ID')} karakter, melebihi batas ${LIMITS.content.toLocaleString('id-ID')} karakter.`);
    }
    const content = withSource(page.text, page.url);
    return { title: page.title.slice(0, LIMITS.title), content, format: page.format, chars: content.length, url: page.url };
  }
}

/**
 * Menjelajahi sebuah situs: halaman awal + tautan di situs yang sama (satu tingkat), maksimal `maxPages`.
 * Hasilnya daftar halaman untuk dipilih admin (tidak disimpan). Berhenti memulai halaman baru setelah `deadlineMs`
 * agar permintaan tidak melewati batas waktu proksi (mis. Cloudflare 100 dtk); sisanya dilaporkan sebagai `partial`.
 */
export class CrawlWebsite {
  constructor({ reader, concurrency = 3, deadlineMs = 60_000, now = () => Date.now() }) { Object.assign(this, { reader, concurrency, deadlineMs, now }); }

  async execute({ url, maxPages = CRAWL_LIMITS.defaultPages, signal }) {
    const limit = Math.min(Math.max(Number.isInteger(maxPages) ? maxPages : CRAWL_LIMITS.defaultPages, 1), CRAWL_LIMITS.maxPages);
    const started = this.now();
    const root = await this.reader.read(url, { signal });
    const candidates = pickSiteLinks(root.links, root.url, limit - 1);

    const results = new Map();
    const skipped = [];
    const take = (page) => results.set(page.url, page);
    take(root);

    let next = 0;
    let partial = false;
    const worker = async () => {
      for (;;) {
        if (signal?.aborted) return;
        if (this.now() - started > this.deadlineMs) { partial = true; return; }
        const index = next;
        next += 1;
        if (index >= candidates.length) return;
        try { take(await this.reader.read(candidates[index], { signal })); } catch (err) {
          if (err?.name === 'AbortError') throw err;
          skipped.push({ url: candidates[index], reason: err instanceof ValidationError ? err.message : 'Gagal diambil' });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, candidates.length) }, worker));

    const order = [root.url, ...candidates];
    const seenText = new Set();
    const seenTitle = new Map();
    const pages = [];
    for (const key of order) {
      const page = results.get(key);
      if (!page) continue;
      if (page.text.length < MIN_CHARS) { skipped.push({ url: page.url, reason: 'Hampir tidak ada teks' }); continue; }
      if (page.text.length > LIMITS.content) { skipped.push({ url: page.url, reason: 'Terlalu panjang' }); continue; }
      if (seenText.has(page.text)) { skipped.push({ url: page.url, reason: 'Isi sama dengan halaman lain' }); continue; }
      seenText.add(page.text);
      let title = (page.title || new URL(page.url).hostname).slice(0, LIMITS.title - 40);
      const count = seenTitle.get(title) ?? 0;
      seenTitle.set(title, count + 1);
      if (count > 0) title = `${title} — ${new URL(page.url).pathname}`.slice(0, LIMITS.title);
      const content = withSource(page.text, page.url);
      pages.push({ url: page.url, title, content, chars: content.length });
    }
    if (!pages.length) throw new ValidationError(NO_TEXT);
    return { pages, skipped, partial, limit };
  }
}
