import { ValidationError } from './errors.js';

export const ASSISTANT_LIMITS = Object.freeze({ name: 60, style: 1000, about: 2000 });

const clean = (value) => (typeof value === 'string' ? value.replace(/\u0000/g, '').trim() : '');

/**
 * Pengaturan perilaku asisten, diisi admin:
 *  - name  : nama asisten
 *  - style : instruksi gaya bicara tambahan
 *  - about : keterangan TENTANG asisten itu sendiri (model, kemampuan) yang boleh disebut saat ditanya
 */
export function createAssistantSettings({ name, style, about }) {
  const settings = { name: clean(name), style: clean(style), about: clean(about) };
  for (const [field, max] of Object.entries(ASSISTANT_LIMITS)) {
    if (settings[field].length > max) throw new ValidationError(`${{ name: 'Nama', style: 'Gaya bicara', about: 'Keterangan tentang asisten' }[field]} maksimal ${max} karakter`);
  }
  return Object.freeze(settings);
}

/** Setelah admin menyimpan, nilai tersimpan dipakai penuh (nama kosong kembali ke nama bawaan); sebelum itu nilai bawaan dari konfigurasi. */
export function resolvePersona(saved, defaults) {
  if (!saved) return { name: defaults.name, style: defaults.style, about: defaults.about ?? '' };
  return { name: saved.name || defaults.name, style: saved.style, about: saved.about };
}
