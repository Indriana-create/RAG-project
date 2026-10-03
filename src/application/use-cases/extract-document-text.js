import { LIMITS } from '../../domain/knowledge-document.js';
import { ValidationError } from '../errors.js';

/**
 * Mengambil teks dari file yang diunggah admin (PDF/DOCX/PPTX/TXT/MD/CSV) untuk ditinjau di editor.
 * Tidak menyimpan apa pun: admin memeriksa/mengubah hasilnya, lalu menyimpannya sebagai knowledge biasa.
 */
export class ExtractDocumentText {
  constructor({ extractor, maxBytes = LIMITS.fileBytes }) { Object.assign(this, { extractor, maxBytes }); }

  async execute({ filename, buffer }) {
    const name = typeof filename === 'string' ? filename.trim() : '';
    if (!name) throw new ValidationError('Nama file wajib dikirim');
    if (!buffer?.length) throw new ValidationError('File kosong');
    if (buffer.length > this.maxBytes) throw new ValidationError(`File terlalu besar (maksimal ${Math.round(this.maxBytes / 1024 / 1024)} MB)`);

    const { text, title, format, pages, slides } = await this.extractor.extract({ filename: name, buffer });
    if (!text) throw new ValidationError('Tidak ada teks yang bisa diambil dari file ini');
    if (text.length > LIMITS.content) {
      throw new ValidationError(`Teks hasil ekstraksi ${text.length.toLocaleString('id-ID')} karakter, melebihi batas ${LIMITS.content.toLocaleString('id-ID')}. Pecah file menjadi beberapa bagian.`);
    }
    return { title, content: text, format, chars: text.length, ...(pages ? { pages } : {}), ...(slides ? { slides } : {}) };
  }
}
