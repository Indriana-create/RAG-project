import { createHash } from 'node:crypto';
import { createChunk } from '../../domain/chunk.js';
import { migrateChunks } from '../persistence/postgres/schema.js';

const toVector = (values) => `[${values.join(',')}]`;

/**
 * Adapter Retriever: pencarian semantik (embedding + cosine) di PostgreSQL/pgvector.
 * Pengindeksan inkremental: hanya chunk baru/berubah yang di-embed (embedding lokal itu mahal).
 */
export class PgVectorRetriever {
  #queue = Promise.resolve();

  /** Membuat retriever: mendeteksi dimensi model embedding lalu menyiapkan skema. */
  static async create({ pool, embedder, model = embedder.model, docPrefix = '', queryPrefix = '', logger = console }) {
    const [probe] = await embedder.embed(['dimensi']);
    await migrateChunks(pool, probe.length, logger);
    return new PgVectorRetriever({ pool, embedder, model, dimension: probe.length, docPrefix, queryPrefix });
  }

  constructor({ pool, embedder, model, dimension, docPrefix = '', queryPrefix = '' }) {
    Object.assign(this, { pool, embedder, model, dimension, docPrefix, queryPrefix });
  }

  index(chunks) {
    const run = this.#queue.then(() => this.#index(chunks));
    this.#queue = run.catch(() => {}); // satu pengindeksan pada satu waktu
    return run;
  }

  #documentText = (c) => `${this.docPrefix}${c.title}\n${c.text}`;
  #hash = (c) => createHash('sha256').update(`${this.model}\n${this.#documentText(c)}`).digest('hex');

  async #index(chunks) {
    const { rows } = await this.pool.query('SELECT id, content_hash FROM knowledge_chunks');
    const existing = new Map(rows.map((r) => [r.id, r.content_hash]));
    const changed = chunks.filter((c) => existing.get(c.id) !== this.#hash(c));

    const vectors = changed.length ? await this.embedder.embed(changed.map(this.#documentText)) : [];
    if (vectors.some((v) => v.length !== this.dimension)) {
      throw new Error(`Dimensi vektor tidak sesuai skema (${this.dimension}); periksa EMBEDDING_MODEL`);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM knowledge_chunks WHERE id <> ALL($1::text[])', [chunks.map((c) => c.id)]);
      for (const [i, c] of changed.entries()) {
        await client.query(
          `INSERT INTO knowledge_chunks (id, document_id, title, idx, text, content_hash, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
           ON CONFLICT (id) DO UPDATE SET document_id = EXCLUDED.document_id, title = EXCLUDED.title, idx = EXCLUDED.idx,
             text = EXCLUDED.text, content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding`,
          [c.id, c.documentId, c.title, c.index, c.text, this.#hash(c), toVector(vectors[i])]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Chunk bertetangga (indeks ±radius pada dokumen yang sama) dari chunk yang diberikan, tanpa chunk itu sendiri. */
  async neighbors(chunks, { radius = 1 } = {}) {
    const docs = [];
    const indexes = [];
    for (const c of chunks) {
      for (let d = -radius; d <= radius; d += 1) {
        if (d !== 0 && c.index + d >= 0) { docs.push(c.documentId); indexes.push(c.index + d); }
      }
    }
    if (!docs.length) return [];
    const { rows } = await this.pool.query(
      `SELECT c.document_id, c.title, c.idx, c.text
         FROM knowledge_chunks c JOIN unnest($1::text[], $2::int[]) AS w(doc, idx) ON c.document_id = w.doc AND c.idx = w.idx`,
      [docs, indexes]);
    return rows.map((r) => createChunk({ documentId: r.document_id, title: r.title, index: r.idx, text: r.text }));
  }

  async search(query, topK, { signal } = {}) {
    const [vector] = await this.embedder.embed([`${this.queryPrefix}${query}`], { signal });
    const { rows } = await this.pool.query(
      `SELECT document_id, title, idx, text, 1 - (embedding <=> $1::vector) AS score
         FROM knowledge_chunks ORDER BY embedding <=> $1::vector LIMIT $2`,
      [toVector(vector), topK]);
    return rows.map((r) => ({
      chunk: createChunk({ documentId: r.document_id, title: r.title, index: r.idx, text: r.text }),
      score: Number(r.score),
    }));
  }
}
