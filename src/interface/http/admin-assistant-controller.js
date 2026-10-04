const text = (value) => (typeof value === 'string' ? value : undefined);

/** Pengaturan asisten (nama, gaya bicara, keterangan tentang diri). Hanya untuk admin yang login. */
export class AdminAssistantController {
  constructor({ assistant, generateSuggestions, translateSuggestions, completeSuggestions }) {
    Object.assign(this, { assistant, generateSuggestions, translateSuggestions, completeSuggestions });
  }

  get = async () => ({ status: 200, body: await this.assistant.get() });

  update = async ({ body, actor, signal }) => {
    const given = body.suggestions;
    let suggestions = typeof given === 'string' || Array.isArray(given) || (given && typeof given === 'object') ? given : undefined;
    // Bahasa yang kosong dilengkapi terjemahan dari bahasa yang terisi (bila LLM tersedia; gagal = disimpan apa adanya).
    if (suggestions !== undefined) suggestions = await this.completeSuggestions(suggestions, { signal });
    return {
      status: 200,
      body: await this.assistant.update({ name: text(body.name), style: text(body.style), about: text(body.about), suggestions }, actor.user.username),
    };
  };

  /** Usulan saran pertanyaan dari LLM berdasarkan knowledge aktif (tidak menyimpan). */
  suggest = async ({ signal }) => ({ status: 200, body: await this.generateSuggestions.execute({ signal }) });

  /** Menerjemahkan daftar saran yang sedang ditulis ke bahasa lainnya. */
  translate = async ({ body, signal }) => ({
    status: 200,
    body: await this.translateSuggestions.execute({ from: text(body.from), lines: Array.isArray(body.lines) || typeof body.lines === 'string' ? body.lines : [], signal }),
  });
}
