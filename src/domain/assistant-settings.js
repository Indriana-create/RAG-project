import { ValidationError } from './errors.js';

export const ASSISTANT_LIMITS = Object.freeze({ name: 60, style: 1000, about: 2000 });
export const SUGGESTION_LIMITS = Object.freeze({ count: 6, length: 120 });

const clean = (value) => (typeof value === 'string' ? value.replace(/\u0000/g, '').trim() : '');

/**
 * Daftar saran pertanyaan untuk layar awal chat. Menerima array atau teks satu-per-baris; baris kosong dan
 * duplikat dibuang. `lenient` (untuk keluaran LLM) memotong kelebihan alih-alih menolak.
 */
export function normalizeSuggestions(value, { lenient = false } = {}) {
  const lines = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [];
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const text = clean(typeof line === 'string' ? line : '').replace(/\s+/g, ' ');
    if (!text || seen.has(text.toLowerCase())) continue;
    if (text.length > SUGGESTION_LIMITS.length) {
      if (lenient) continue;
      throw new ValidationError(`Saran pertanyaan maksimal ${SUGGESTION_LIMITS.length} karakter per baris`);
    }
    seen.add(text.toLowerCase());
    out.push(text);
  }
  if (out.length > SUGGESTION_LIMITS.count) {
    if (!lenient) throw new ValidationError(`Saran pertanyaan maksimal ${SUGGESTION_LIMITS.count} baris`);
    out.length = SUGGESTION_LIMITS.count;
  }
  return out;
}

export const SUGGESTION_LANGUAGES = Object.freeze(['id', 'en']);

/**
 * Saran pertanyaan per bahasa antarmuka: { id: [...], en: [...] }. Menerima bentuk lama (satu daftar = Indonesia)
 * dan objek dengan kunci id/en yang berisi array atau teks satu-per-baris.
 */
export function normalizeSuggestionSet(value, options) {
  const set = Array.isArray(value) || typeof value === 'string' ? { id: value } : (value && typeof value === 'object' ? value : {});
  return { id: normalizeSuggestions(set.id, options), en: normalizeSuggestions(set.en, options) };
}

/**
 * Pengaturan perilaku asisten, diisi admin:
 *  - name  : nama asisten
 *  - style : instruksi gaya bicara tambahan
 *  - about : keterangan TENTANG asisten itu sendiri (model, kemampuan) yang boleh disebut saat ditanya
 *  - suggestions : saran pertanyaan di layar awal chat per bahasa {id, en} (kosong = otomatis dari judul knowledge)
 */
export function createAssistantSettings({ name, style, about, suggestions }) {
  const settings = { name: clean(name), style: clean(style), about: clean(about) };
  for (const [field, max] of Object.entries(ASSISTANT_LIMITS)) {
    if (settings[field].length > max) throw new ValidationError(`${{ name: 'Nama', style: 'Gaya bicara', about: 'Keterangan tentang asisten' }[field]} maksimal ${max} karakter`);
  }
  return Object.freeze({ ...settings, suggestions: normalizeSuggestionSet(suggestions) });
}

/** Setelah admin menyimpan, nilai tersimpan dipakai penuh (nama kosong kembali ke nama bawaan); sebelum itu nilai bawaan dari konfigurasi. */
export function resolvePersona(saved, defaults) {
  if (!saved) return { name: defaults.name, style: defaults.style, about: defaults.about ?? '' };
  return { name: saved.name || defaults.name, style: saved.style, about: saved.about };
}
