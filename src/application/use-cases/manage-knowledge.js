import { createKnowledgeDocument, summarize } from '../../domain/knowledge-document.js';
import { NotFoundError } from '../errors.js';

export class ListKnowledge {
  constructor({ repository }) { this.repository = repository; }
  async execute() { return (await this.repository.list()).map(summarize); }
}

export class GetKnowledge {
  constructor({ repository }) { this.repository = repository; }
  async execute({ id }) {
    const doc = await this.repository.get(id);
    if (!doc) throw new NotFoundError('Knowledge tidak ditemukan');
    return doc;
  }
}

/** Membuat (tanpa id) atau memperbarui sebagian (dengan id): judul, isi, dan/atau status aktif. */
export class SaveKnowledge {
  constructor({ repository, reindex, newId }) { Object.assign(this, { repository, reindex, newId }); }

  async execute({ id, title, content, enabled }) {
    const now = new Date().toISOString();
    let doc;
    if (id) {
      const existing = await this.repository.get(id);
      if (!existing) throw new NotFoundError('Knowledge tidak ditemukan');
      doc = createKnowledgeDocument({
        ...existing,
        title: title ?? existing.title,
        content: content ?? existing.content,
        enabled: enabled ?? existing.enabled,
        updatedAt: now,
      });
    } else {
      doc = createKnowledgeDocument({ id: this.newId(), title, content, enabled: enabled ?? true, createdAt: now, updatedAt: now });
    }
    await this.repository.save(doc);
    await this.reindex.execute();
    return doc;
  }
}

export class DeleteKnowledge {
  constructor({ repository, reindex }) { Object.assign(this, { repository, reindex }); }
  async execute({ id }) {
    if (!(await this.repository.delete(id))) throw new NotFoundError('Knowledge tidak ditemukan');
    await this.reindex.execute();
  }
}
