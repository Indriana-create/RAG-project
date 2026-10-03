import { createKnowledgeDocument } from '../../domain/knowledge-document.js';

/** Mengisi repository dari dokumen awal HANYA bila repository masih kosong. */
export class SeedKnowledge {
  constructor({ repository, documentSource }) {
    this.repository = repository;
    this.documentSource = documentSource;
  }

  async execute() {
    if ((await this.repository.list()).length > 0) return 0;
    const docs = await this.documentSource.loadAll();
    const now = new Date().toISOString();
    for (const d of docs) {
      await this.repository.save(createKnowledgeDocument({ ...d, enabled: true, createdAt: now, updatedAt: now }));
    }
    return docs.length;
  }
}
