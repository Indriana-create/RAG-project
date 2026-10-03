import { createAssistantSettings, resolvePersona } from '../../domain/assistant-settings.js';

const KEY = 'assistant';

/**
 * Pengaturan asisten yang dapat diubah admin tanpa restart. Hasilnya dipakai tiap giliran chat (`current()`).
 * Cache di memori; satu instance aplikasi sehingga cukup diperbarui saat `update()`.
 */
export class AssistantSettingsService {
  #cache;

  constructor({ repository, defaults, now = () => new Date() }) { Object.assign(this, { repository, defaults, now }); }

  async #saved() {
    if (this.#cache === undefined) this.#cache = (await this.repository.get(KEY)) ?? null;
    return this.#cache;
  }

  /** Persona yang dipakai chat sekarang: { name, style, about }. */
  async current() { return resolvePersona((await this.#saved())?.value, this.defaults); }

  /** Saran pertanyaan yang diatur admin untuk layar awal chat ([] = pakai judul knowledge). */
  async suggestions() { return (await this.#saved())?.value?.suggestions ?? []; }

  /** Untuk halaman admin: persona + keterangan siapa/kapan terakhir mengubah. */
  async get() {
    const saved = await this.#saved();
    return { ...resolvePersona(saved?.value, this.defaults), suggestions: saved?.value?.suggestions ?? [], isDefault: !saved, updatedAt: saved?.updatedAt ?? null, updatedBy: saved?.updatedBy ?? null };
  }

  /** `suggestions` yang tidak dikirim (undefined) mempertahankan nilai tersimpan, sehingga klien lama tidak menghapusnya. */
  async update({ name, style, about, suggestions }, updatedBy) {
    const kept = suggestions === undefined ? (await this.#saved())?.value?.suggestions : suggestions;
    const value = createAssistantSettings({ name, style, about, suggestions: kept });
    const record = { value, updatedAt: this.now().toISOString(), updatedBy };
    await this.repository.set(KEY, record);
    this.#cache = record;
    return this.get();
  }
}
