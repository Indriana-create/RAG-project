const text = (value) => (typeof value === 'string' ? value : undefined);

/** Pengaturan asisten (nama, gaya bicara, keterangan tentang diri). Hanya untuk admin yang login. */
export class AdminAssistantController {
  constructor({ assistant, generateSuggestions }) { Object.assign(this, { assistant, generateSuggestions }); }

  get = async () => ({ status: 200, body: await this.assistant.get() });

  update = async ({ body, actor }) => ({
    status: 200,
    body: await this.assistant.update({
      name: text(body.name), style: text(body.style), about: text(body.about),
      suggestions: Array.isArray(body.suggestions) || typeof body.suggestions === 'string' ? body.suggestions : undefined,
    }, actor.user.username),
  });

  /** Usulan saran pertanyaan dari LLM berdasarkan knowledge aktif (tidak menyimpan). */
  suggest = async ({ signal }) => ({ status: 200, body: await this.generateSuggestions.execute({ signal }) });
}
