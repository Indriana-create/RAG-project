// Hanya field ini yang boleh diubah klien (mencegah mass assignment id/timestamp).
const fields = ({ title, content, enabled } = {}) => ({ title, content, enabled });

export class AdminKnowledgeController {
  constructor({ listKnowledge, getKnowledge, saveKnowledge, deleteKnowledge, searchKnowledge, extractDocumentText }) {
    Object.assign(this, { listKnowledge, getKnowledge, saveKnowledge, deleteKnowledge, searchKnowledge, extractDocumentText });
  }
  list = async () => ({ status: 200, body: { items: await this.listKnowledge.execute() } });
  get = async ({ params }) => ({ status: 200, body: await this.getKnowledge.execute(params) });
  create = async ({ body }) => ({ status: 201, body: await this.saveKnowledge.execute(fields(body)) });
  update = async ({ params, body }) => ({ status: 200, body: await this.saveKnowledge.execute({ ...fields(body), id: params.id }) });
  /** Unggah file mentah (nama di header x-filename, di-encode URL); mengembalikan teks untuk ditinjau, tidak menyimpan. */
  extract = async ({ body, headers }) => {
    let filename = '';
    try { filename = decodeURIComponent(String(headers['x-filename'] ?? '')); } catch { /* nama rusak: dianggap kosong */ }
    return { status: 200, body: await this.extractDocumentText.execute({ filename, buffer: body }) };
  };
  search = async ({ body, signal }) => ({ status: 200, body: await this.searchKnowledge.execute({ query: body?.query, signal }) });
  remove = async ({ params }) => { await this.deleteKnowledge.execute(params); return { status: 204 }; };
}
