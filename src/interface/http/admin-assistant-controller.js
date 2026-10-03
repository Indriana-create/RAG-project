const text = (value) => (typeof value === 'string' ? value : undefined);

/** Pengaturan asisten (nama, gaya bicara, keterangan tentang diri). Hanya untuk admin yang login. */
export class AdminAssistantController {
  constructor({ assistant }) { this.assistant = assistant; }

  get = async () => ({ status: 200, body: await this.assistant.get() });

  update = async ({ body, actor }) => ({
    status: 200,
    body: await this.assistant.update({ name: text(body.name), style: text(body.style), about: text(body.about) }, actor.user.username),
  });
}
