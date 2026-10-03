import { ValidationError } from '../../domain/errors.js';
import { normalizeText } from '../documents/index.js';
import { extractPlain } from '../documents/plain.js';
import { extractLinks, htmlToText } from './html.js';

const DOCUMENT_TYPES = [
  [/pdf/, '.pdf'],
  [/wordprocessingml\.document/, '.docx'],
  [/presentationml\.presentation/, '.pptx'],
];
const BY_EXTENSION = /\.(pdf|docx|pptx|txt|md|csv|html?)$/i;

/** Mendekode isi halaman: charset dari header HTTP, lalu dari <meta>, bawaan UTF-8. */
function decodeText(body, contentType) {
  const declared = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1]
    ?? /<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(body.subarray(0, 4096).toString('latin1'))?.[1];
  try { return new TextDecoder(declared || 'utf-8').decode(body); } catch { return new TextDecoder('utf-8').decode(body); }
}

/**
 * Adapter WebPageReader: mengambil sebuah URL (lewat pengambil yang aman) lalu mengubahnya menjadi teks.
 * HTML dibaca langsung; PDF/DOCX/PPTX di alamat itu diserahkan ke pembaca dokumen yang sama dengan unggah file.
 */
export class WebPageReader {
  constructor({ fetcher, documentExtractor }) { Object.assign(this, { fetcher, documentExtractor }); }

  /** @returns {Promise<{url: string, title: string, text: string, links: string[], format: string}>} */
  async read(url, { signal } = {}) {
    const page = await this.fetcher.fetch(url, { signal });
    const { pathname } = new URL(page.url);
    const type = page.contentType.split(';')[0].trim();
    const ext = BY_EXTENSION.exec(pathname)?.[1]?.toLowerCase();

    const documentExt = DOCUMENT_TYPES.find(([pattern]) => pattern.test(type))?.[1] ?? (!type || type === 'application/octet-stream' ? (ext && ['pdf', 'docx', 'pptx'].includes(ext) ? `.${ext}` : undefined) : undefined);
    if (documentExt) {
      const name = decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? 'dokumen').replace(/\.[^.]+$/, '') || 'dokumen';
      const doc = await this.documentExtractor.extract({ filename: `${name}${documentExt}`, buffer: page.body });
      return { url: page.url, title: doc.title, text: doc.text, links: [], format: doc.format };
    }
    if (/html|xhtml/.test(type) || (!type && ext && /html?/.test(ext))) {
      const html = decodeText(page.body, page.contentType);
      const { title, text } = htmlToText(html);
      return { url: page.url, title: title || new URL(page.url).hostname, text: normalizeText(text), links: extractLinks(html, page.url), format: 'WEB' };
    }
    if (type.startsWith('text/')) {
      const { text } = extractPlain(page.body);
      return { url: page.url, title: decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? new URL(page.url).hostname), text: normalizeText(text), links: [], format: 'TXT' };
    }
    throw new ValidationError(`Jenis isi "${type || 'tidak diketahui'}" belum didukung. Gunakan alamat halaman web, PDF, DOCX, atau PPTX.`);
  }
}
