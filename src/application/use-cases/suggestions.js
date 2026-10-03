import { normalizeSuggestions } from '../../domain/assistant-settings.js';
import { cleanTopics } from '../../domain/fallback.js';
import { UpstreamError } from '../../domain/errors.js';
import { ValidationError } from '../errors.js';

const MAX_TOPICS = 6;
const DIGEST_DOCS = 12;
const DIGEST_CHARS = 400;

/**
 * Saran pertanyaan untuk layar awal chat (publik). Bila admin sudah mengaturnya, itulah yang dipakai;
 * bila belum, klien membuatnya dari judul knowledge aktif (`topics`), sehingga selalu mengikuti isi knowledge.
 */
export class GetSuggestions {
  constructor({ assistant, repository }) { Object.assign(this, { assistant, repository }); }

  async execute() {
    const [suggestions, docs] = await Promise.all([this.assistant.suggestions(), this.repository.list()]);
    return { suggestions, topics: cleanTopics(docs.filter((d) => d.enabled).map((d) => d.title)).slice(0, MAX_TOPICS) };
  }
}

const SYSTEM = [
  'Anda membantu pemilik layanan menyiapkan contoh pertanyaan untuk layar awal chatbot layanan pelanggan.',
  'Tulis pertanyaan singkat dan natural yang biasa ditanyakan pelanggan, yang jawabannya BENAR-BENAR ada pada materi yang diberikan.',
  'Aturan keluaran: tepat satu pertanyaan per baris, tanpa nomor, tanpa tanda kutip, tanpa penjelasan lain. Setiap pertanyaan maksimal 100 karakter.',
  'Gunakan bahasa yang sama dengan materi. Variasikan topiknya; jangan mengulang pertanyaan yang mirip.',
].join('\n');

/** Mengubah keluaran LLM menjadi daftar saran: buang penomoran/butir/kutip, baris yang bukan pertanyaan, dan duplikat. */
export function parseSuggestionLines(text) {
  const lines = String(text).split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '').trim())
    .filter((line) => line.length >= 8 && /[?\uFF1F]$|^(?:apa|bagaimana|berapa|kapan|siapa|di mana|dimana|mengapa|kenapa|apakah|bisakah|what|how|when|who|where|why|can|do|does|is|are)\b/i.test(line));
  return normalizeSuggestions(lines, { lenient: true });
}

/** Meminta LLM menyusun saran pertanyaan dari knowledge aktif. Hanya mengembalikan usulan; admin yang memutuskan menyimpannya. */
export class GenerateSuggestions {
  constructor({ repository, generator }) { Object.assign(this, { repository, generator }); }

  async execute({ signal } = {}) {
    if (typeof this.generator.complete !== 'function') {
      throw new ValidationError('Pembuatan saran otomatis memerlukan LLM yang aktif (LLM_BASE_URL). Isi saran secara manual atau biarkan kosong untuk memakai judul knowledge.');
    }
    const docs = (await this.repository.list()).filter((d) => d.enabled).slice(0, DIGEST_DOCS);
    if (!docs.length) throw new ValidationError('Belum ada knowledge aktif untuk dijadikan saran pertanyaan.');
    const digest = docs.map((d, i) => `[${i + 1}] ${d.title}\n${d.content.replace(/\s+/g, ' ').slice(0, DIGEST_CHARS)}`).join('\n\n');
    const text = await this.generator.complete({ system: SYSTEM, user: `Materi:\n${digest}\n\nTulis 4 pertanyaan contoh.`, signal });
    const suggestions = parseSuggestionLines(text);
    if (!suggestions.length) throw new UpstreamError('LLM tidak menghasilkan saran yang bisa dipakai');
    return { suggestions };
  }
}
