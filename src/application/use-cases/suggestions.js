import { normalizeSuggestionSet, normalizeSuggestions } from '../../domain/assistant-settings.js';
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
  'Tulis dalam bahasa Indonesia, meskipun materinya berbahasa lain. Variasikan topiknya; jangan mengulang pertanyaan yang mirip.',
].join('\n');

/** Mengubah keluaran LLM menjadi daftar saran: buang penomoran/butir/kutip, baris yang bukan pertanyaan, dan duplikat. */
export function parseSuggestionLines(text) {
  const lines = String(text).split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '').trim())
    .filter((line) => line.length >= 8 && /[?\uFF1F]$|^(?:apa|bagaimana|berapa|kapan|siapa|di mana|dimana|mengapa|kenapa|apakah|bisakah|what|how|when|who|where|why|can|do|does|is|are)\b/i.test(line));
  return normalizeSuggestions(lines, { lenient: true });
}

const LANGUAGE_NAME = { id: 'bahasa Indonesia', en: 'bahasa Inggris (English)' };
const TRANSLATE_TIMEOUT_MS = 45_000;

/** Keluaran terjemahan: satu baris per butir, penomoran/butir/kutip dibuang. Jumlah baris harus sama dengan masukan. */
export function parseTranslatedLines(text, expected) {
  const lines = String(text).split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '').trim())
    .filter(Boolean);
  if (lines.length < expected) throw new UpstreamError('Terjemahan dari LLM tidak lengkap');
  return lines.slice(0, expected);
}

/** Menerjemahkan daftar saran antara Indonesia dan English lewat LLM; urutan baris dipertahankan. */
export async function translateLines(generator, { from, lines, signal }) {
  if (typeof generator.complete !== 'function') {
    throw new ValidationError('Terjemahan otomatis memerlukan LLM yang aktif (LLM_BASE_URL). Isi kedua bahasa secara manual.');
  }
  const source = normalizeSuggestions(lines);
  if (!source.length) return [];
  const to = from === 'id' ? 'en' : 'id';
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(TRANSLATE_TIMEOUT_MS)]) : AbortSignal.timeout(TRANSLATE_TIMEOUT_MS);
  const text = await generator.complete({
    system: `Anda penerjemah. Terjemahkan setiap baris dari ${LANGUAGE_NAME[from]} ke ${LANGUAGE_NAME[to]} secara alami. Keluarkan tepat ${source.length} baris dengan urutan yang sama, satu terjemahan per baris, tanpa nomor, tanpa tanda kutip, tanpa penjelasan lain.`,
    user: source.join('\n'),
    maxTokens: 400,
    temperature: 0.1,
    signal: combined,
  });
  return normalizeSuggestions(parseTranslatedLines(text, source.length), { lenient: true });
}

/** Menerjemahkan saran yang sedang ditulis admin ke bahasa lainnya (tombol "Terjemahkan"). */
export class TranslateSuggestions {
  constructor({ generator }) { this.generator = generator; }

  async execute({ from, lines, signal }) {
    if (from !== 'id' && from !== 'en') throw new ValidationError('Bahasa asal harus "id" atau "en"');
    return { lines: await translateLines(this.generator, { from, lines, signal }) };
  }
}

/** Melengkapi bahasa yang kosong dengan terjemahan bahasa yang terisi. Gagal menerjemahkan tidak menggagalkan penyimpanan. */
export async function completeSuggestionSet(generator, set, { signal } = {}) {
  const filled = normalizeSuggestionSet(set);
  const from = filled.id.length && !filled.en.length ? 'id' : filled.en.length && !filled.id.length ? 'en' : null;
  if (!from || typeof generator.complete !== 'function') return filled;
  try {
    const lines = await translateLines(generator, { from, lines: filled[from], signal });
    return { ...filled, [from === 'id' ? 'en' : 'id']: lines };
  } catch (err) {
    if (err?.name === 'AbortError' && signal?.aborted) throw err;
    return filled;
  }
}

/**
 * Meminta LLM menyusun saran pertanyaan dari knowledge aktif (Indonesia), lalu menerjemahkannya ke English.
 * Hanya mengembalikan usulan; admin yang memutuskan menyimpannya. Bila terjemahan gagal, daftar English dikosongkan
 * dan `warning` menjelaskannya.
 */
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
    const id = parseSuggestionLines(text);
    if (!id.length) throw new UpstreamError('LLM tidak menghasilkan saran yang bisa dipakai');
    try {
      return { suggestions: { id, en: await translateLines(this.generator, { from: 'id', lines: id, signal }) } };
    } catch (err) {
      if (err?.name === 'AbortError' && signal?.aborted) throw err;
      return { suggestions: { id, en: [] }, warning: 'Saran bahasa Indonesia berhasil dibuat, tetapi terjemahan English gagal. Coba klik "Terjemahkan ke English".' };
    }
  }
}
