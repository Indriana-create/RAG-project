import { ValidationError } from '../../domain/errors.js';

const MAX_PAGES = 1000;
const TIMEOUT_MS = 90_000;
let pdfjs;
const load = () => (pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs'));

/** Susun item teks sebuah halaman menjadi baris dan paragraf berdasarkan posisinya. */
function pageText(items) {
  let out = '';
  let last;
  // Pastikan teks berakhir dengan tepat `count` baris baru (hasEOL dan jarak vertikal tidak boleh menghitung ganda).
  const breakTo = (count) => {
    const have = out.length - out.replace(/\n+$/, '').length;
    if (have < count) out += '\n'.repeat(count - have);
  };
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const [, , , , x, y] = item.transform;
    const height = Math.abs(item.height) || 10;
    if (last) {
      const dy = Math.abs(y - last.y);
      if (dy > height * 1.9) breakTo(2);
      else if (dy > height * 0.5) breakTo(1);
      else if (x - (last.x + last.width) > height * 0.15 && !/[\s]$/.test(out) && !item.str.startsWith(' ')) out += ' ';
    }
    out += item.str;
    if (item.hasEOL) breakTo(1);
    last = { x, y, width: item.width ?? 0 };
  }
  return out;
}

/** Teks dari PDF (yang berisi teks; hasil scan/gambar memerlukan OCR dan belum didukung). */
export async function extractPdf(buffer) {
  const { getDocument } = await load();
  const task = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false, // defense in depth terhadap kelas celah "PDF menjalankan JavaScript"
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const timer = setTimeout(() => task.destroy(), TIMEOUT_MS);
  try {
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const parts = [];
    for (let n = 1; n <= pages; n += 1) {
      const page = await doc.getPage(n);
      parts.push(pageText((await page.getTextContent()).items));
      page.cleanup();
    }
    const text = parts.join('\n\n');
    if (text.replace(/\s/g, '').length < 20) {
      throw new ValidationError('PDF ini tidak berisi teks yang bisa dibaca (mungkin hasil scan atau gambar). Pengenalan teks dari gambar (OCR) belum didukung.');
    }
    return { text, pages: doc.numPages, truncated: doc.numPages > MAX_PAGES };
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    if (err?.name === 'PasswordException') throw new ValidationError('PDF dilindungi password; buka dulu lalu simpan tanpa password.');
    throw new ValidationError('PDF tidak bisa dibaca (file rusak atau formatnya tidak didukung).');
  } finally {
    clearTimeout(timer);
    await Promise.resolve(task.destroy()).catch(() => {}); // melepas memori dokumen dan worker
  }
}
