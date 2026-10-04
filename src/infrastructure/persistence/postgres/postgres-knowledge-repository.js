import { createKnowledgeDocument } from '../../../domain/knowledge-document.js';

const toDocument = (row) => createKnowledgeDocument({
  id: row.id,
  title: row.title,
  content: row.content,
  enabled: row.enabled,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/** Adapter KnowledgeRepository di atas PostgreSQL (menerima `pg.Pool`). */
export class PostgresKnowledgeRepository {
  constructor(pool) { this.pool = pool; }

  async list() {
    const { rows } = await this.pool.query('SELECT * FROM knowledge_documents ORDER BY created_at, title');
    return rows.map(toDocument);
  }

  async get(id) {
    const { rows } = await this.pool.query('SELECT * FROM knowledge_documents WHERE id = $1', [id]);
    return rows[0] && toDocument(rows[0]);
  }

  async save(doc) {
    await this.pool.query(
      `INSERT INTO knowledge_documents (id, title, content, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, content = EXCLUDED.content, enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
      [doc.id, doc.title, doc.content, doc.enabled, doc.createdAt, doc.updatedAt]);
  }

  async delete(id) {
    const { rowCount } = await this.pool.query('DELETE FROM knowledge_documents WHERE id = $1', [id]);
    return rowCount > 0;
  }
}
