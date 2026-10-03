/** Migrasi skema idempoten; dijalankan saat start. */
export async function migrateDocuments(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id          text PRIMARY KEY,
      title       text        NOT NULL,
      content     text        NOT NULL,
      enabled     boolean     NOT NULL DEFAULT true,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    )`);
}

/**
 * Tabel chunk + vektor. Isinya TURUNAN dari knowledge_documents, jadi aman dibuat
 * ulang bila dimensi embedding berubah (mis. ganti model embedding).
 */
export async function migrateChunks(pool, dimension, logger = console) {
  if (!Number.isInteger(dimension) || dimension < 1 || dimension > 16000) throw new Error(`Dimensi embedding tidak valid: ${dimension}`);

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  } catch (err) {
    const { rowCount } = await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");
    if (!rowCount) {
      throw new Error(`Ekstensi pgvector belum aktif dan user database tidak boleh membuatnya (${err.message}). ` +
        'Jalankan sekali sebagai superuser: CREATE EXTENSION vector;');
    }
  }

  const { rows } = await pool.query(
    `SELECT a.atttypmod AS dimension FROM pg_attribute a
      WHERE a.attrelid = to_regclass('knowledge_chunks') AND a.attname = 'embedding' AND NOT a.attisdropped`);
  if (rows[0] && rows[0].dimension !== dimension) {
    logger.warn(`Dimensi embedding berubah (${rows[0].dimension} → ${dimension}); tabel knowledge_chunks dibuat ulang dan diindeks ulang.`);
    await pool.query('DROP TABLE knowledge_chunks');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id           text PRIMARY KEY,
      document_id  text    NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      title        text    NOT NULL,
      idx          integer NOT NULL,
      text         text    NOT NULL,
      content_hash text    NOT NULL,
      embedding    vector(${dimension}) NOT NULL
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS knowledge_chunks_document_idx ON knowledge_chunks (document_id)');
  try {
    await pool.query('CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)');
  } catch (err) {
    logger.warn(`Indeks HNSW dilewati (pencarian tetap jalan, hanya tanpa indeks): ${err.message}`);
  }
}
