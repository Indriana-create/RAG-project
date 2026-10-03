import path from 'node:path';
import { ValidationError } from '../../domain/errors.js';
import { extractDocx } from './docx.js';
import { extractPdf } from './pdf.js';
import { extractPlain } from './plain.js';
import { extractPptx } from './pptx.js';

export const SUPPORTED_EXTENSIONS = Object.freeze(['.pdf', '.docx', '.pptx', '.txt', '.md', '.markdown', '.csv']);
const LEGACY = { '.doc': 'Word (.doc)', '.ppt': 'PowerPoint (.ppt)', '.xls': 'Excel (.xls)' };

const isZip = (b) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isPdf = (b) => b.subarray(0, 1024).includes('%PDF-');

/** Merapikan teks hasil ekstraksi agar pemecah paragraf (baris kosong) bekerja baik. */
export function normalizeText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const titleOf = (filename, ext, text) => {
  const heading = ext === '.md' || ext === '.markdown' ? /^#\s+(.+)$/m.exec(text)?.[1]?.trim() : undefined;
  return (heading || path.basename(filename, path.extname(filename))).slice(0, 120);
};

/**
 * Adapter DocumentTextExtractor: PDF, DOCX, PPTX, dan teks polos. Jenis ditentukan dari ekstensi,
 * lalu isi file diperiksa (bukan sekadar percaya nama) sebelum diproses.
 */
export function createDocumentTextExtractor() {
  return {
    supported: SUPPORTED_EXTENSIONS,

    /** @returns {Promise<{text: string, title: string, format: string, pages?: number, slides?: number}>} */
    async extract({ filename, buffer }) {
      const ext = path.extname(String(filename ?? '')).toLowerCase();
      if (LEGACY[ext]) {
        throw new ValidationError(`Format ${LEGACY[ext]} lama belum didukung. Buka file itu lalu "Simpan sebagai" ${ext === '.doc' ? 'DOCX' : ext === '.ppt' ? 'PPTX' : 'CSV'} atau PDF.`);
      }
      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        throw new ValidationError('Format file belum didukung. Gunakan PDF, DOCX, PPTX, TXT, MD, atau CSV.');
      }

      let result;
      let format;
      if (ext === '.pdf') {
        if (!isPdf(buffer)) throw new ValidationError('File ini bukan PDF yang valid.');
        format = 'PDF';
        result = await extractPdf(buffer);
      } else if (ext === '.docx' || ext === '.pptx') {
        if (!isZip(buffer)) throw new ValidationError(`File ini bukan ${ext.slice(1).toUpperCase()} yang valid.`);
        format = ext.slice(1).toUpperCase();
        result = ext === '.docx' ? extractDocx(buffer) : extractPptx(buffer);
      } else {
        if (isPdf(buffer) || isZip(buffer)) throw new ValidationError('Isi file tidak cocok dengan ekstensinya (tampaknya PDF/ZIP, bukan teks).');
        format = ext.slice(1).toUpperCase();
        result = extractPlain(buffer);
      }
      const text = normalizeText(result.text);
      return { text, title: titleOf(filename, ext, text), format, pages: result.pages, slides: result.slides };
    },
  };
}
