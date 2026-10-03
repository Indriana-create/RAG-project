import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { startFakeLlm } from './helpers/fake-llm.js';
import { createKnowledgeDocument } from '../src/domain/knowledge-document.js';
import { createChunk } from '../src/domain/chunk.js';
import { migrateDocuments } from '../src/infrastructure/persistence/postgres/schema.js';
import { PostgresKnowledgeRepository } from '../src/infrastructure/persistence/postgres/postgres-knowledge-repository.js';
import { PgVectorRetriever } from '../src/infrastructure/retrieval/pgvector-retriever.js';
import { OpenAiCompatibleEmbedder } from '../src/infrastructure/embedding/openai-compatible-embedder.js';
import { createDependencies } from '../src/bootstrap.js';
import { buildApp } from '../src/composition.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const opts = { skip: DATABASE_URL ? false : 'set TEST_DATABASE_URL (PostgreSQL + pgvector) untuk menjalankan tes ini' };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'rahasia-test';
const quiet = { warn() {}, log() {} };

let pool;
before(() => { if (DATABASE_URL) pool = new pg.Pool({ connectionString: DATABASE_URL }); });
after(() => pool?.end());
const reset = () => pool.query('DROP TABLE IF EXISTS knowledge_chunks, knowledge_documents CASCADE');
const doc = (id, title, content, enabled = true) => createKnowledgeDocument({ id, title, content, enabled, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
const chunk = (documentId, title, text, index = 0) => createChunk({ documentId, title, index, text });

test('PostgresKnowledgeRepository: simpan, ubah, ambil, daftar, hapus', opts, async () => {
  await reset();
  await migrateDocuments(pool);
  const repo = new PostgresKnowledgeRepository(pool);
  await repo.save(doc('a', 'Garansi', 'Garansi 24 bulan.'));
  await repo.save(doc('b', 'Kirim', 'Kirim 2 hari.', false));
  await repo.save({ ...doc('a', 'Garansi baru', 'Garansi 36 bulan.'), updatedAt: '2026-02-02T00:00:00.000Z' }); // upsert
  const a = await repo.get('a');
  assert.equal(a.title, 'Garansi baru');
  assert.equal(a.createdAt, '2026-01-01T00:00:00.000Z'); // created_at tidak berubah saat update
  assert.equal(a.updatedAt, '2026-02-02T00:00:00.000Z');
  assert.deepEqual((await repo.list()).map((d) => [d.id, d.enabled]), [['a', true], ['b', false]]);
  assert.equal(await repo.get('zzz'), undefined);
  assert.equal(await repo.delete('b'), true);
  assert.equal(await repo.delete('b'), false);
  assert.equal((await repo.list()).length, 1);
});

test('PgVectorRetriever: pencarian semantik, indeks inkremental, hapus chunk', opts, async () => {
  await reset();
  await migrateDocuments(pool);
  const repo = new PostgresKnowledgeRepository(pool);
  for (const id of ['g', 'k', 'p']) await repo.save(doc(id, id, 'x')); // memenuhi FK
  const llm = await startFakeLlm();
  try {
    const embedder = new OpenAiCompatibleEmbedder({ baseUrl: llm.baseUrl, model: 'emb' });
    const retriever = await PgVectorRetriever.create({ pool, embedder, logger: quiet });
    assert.equal(retriever.dimension, 32);

    const chunks = [
      chunk('g', 'Garansi', 'Garansi resmi produk berlaku 24 bulan sejak pembelian.'),
      chunk('k', 'Pengiriman', 'Pengiriman luar Jawa memakan waktu 5 sampai 9 hari kerja.'),
      chunk('p', 'Pembayaran', 'Pembayaran bisa memakai QRIS dan transfer bank.'),
    ];
    llm.state.embeddedTexts = 0;
    await retriever.index(chunks);
    assert.equal(llm.state.embeddedTexts, 3);

    const hits = await retriever.search('berapa lama garansi produk?', 3);
    assert.equal(hits[0].chunk.documentId, 'g');
    assert.ok(hits[0].score > hits[1].score && hits[0].score <= 1);
    assert.equal(hits[0].chunk.id, 'g#0');

    // indeks ulang tanpa perubahan → tidak ada embedding baru; satu berubah → hanya satu
    llm.state.embeddedTexts = 0;
    await retriever.index(chunks);
    assert.equal(llm.state.embeddedTexts, 0);
    await retriever.index([chunks[0], { ...chunks[1], text: 'Pengiriman luar Jawa kini 3 sampai 6 hari kerja.' }, chunks[2]]);
    assert.equal(llm.state.embeddedTexts, 1);

    // chunk yang tidak lagi diminta (dokumen dinonaktifkan) dihapus
    await retriever.index([chunks[0]]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM knowledge_chunks')).rows[0].n, 1);
    assert.deepEqual((await retriever.search('pembayaran qris', 5)).map((h) => h.chunk.documentId), ['g']);
    await retriever.index([]);
    assert.deepEqual(await retriever.search('garansi', 5), []);
  } finally { await llm.stop(); }
});

test('PgVectorRetriever: dimensi embedding berubah → tabel chunk dibuat ulang', opts, async () => {
  await reset();
  await migrateDocuments(pool);
  const stub = (dim) => ({ model: `m${dim}`, embed: async (texts) => texts.map(() => Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0))) });
  const repo = new PostgresKnowledgeRepository(pool);
  await repo.save(doc('a', 'A', 'isi'));
  const r3 = await PgVectorRetriever.create({ pool, embedder: stub(3), logger: quiet });
  await r3.index([chunk('a', 'A', 'isi')]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM knowledge_chunks')).rows[0].n, 1);
  const warnings = [];
  const r4 = await PgVectorRetriever.create({ pool, embedder: stub(4), logger: { warn: (m) => warnings.push(m) } });
  assert.equal(r4.dimension, 4);
  assert.match(warnings[0], /3 → 4/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM knowledge_chunks')).rows[0].n, 0);
  await r4.index([chunk('a', 'A', 'isi')]);
  assert.equal((await r4.search('isi', 1))[0].chunk.documentId, 'a');
});

test('bootstrap penuh: PostgreSQL + pgvector + LLM lokal (streaming) lewat HTTP', opts, async () => {
  await reset();
  const llm = await startFakeLlm({ reply: () => 'Garansi resmi berlaku 24 bulan.' });
  const deps = await createDependencies({
    DATABASE_URL, EMBEDDING_MODEL: 'emb', LLM_BASE_URL: llm.baseUrl, LLM_MODEL: 'qwen', LLM_API_KEY: 'lokal', MIN_SCORE: '0.3',
  }, { logger: quiet });
  const app = await buildApp({ ...deps, seedDir: path.join(root, 'knowledge'), publicDir: path.join(root, 'src/interface/web'), adminToken: TOKEN });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://localhost:${app.server.address().port}`;
  const call = (method, url, body, auth = true) => fetch(base + url, {
    method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const stream = async (question) => {
    const res = await call('POST', '/api/chat/stream', { sessionId: 's1', question }, false);
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    return (await res.text()).trim().split('\n\n').map((b) => JSON.parse(b.replace(/^data: /, '')));
  };

  try {
    assert.match(deps.description.retrieval, /pgvector/);
    assert.equal(app.seeded, 4);
    assert.equal(app.stats.chunks, 4);

    const created = await (await call('POST', '/api/admin/knowledge', { title: 'Garansi', content: 'Garansi resmi produk berlaku 24 bulan sejak pembelian.' })).json();
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM knowledge_chunks')).rows[0].n, 5);

    const events = await stream('berapa lama garansi produk?');
    assert.equal(events[0].type, 'sources');
    assert.equal(events[0].sources[0].id, created.id);
    assert.equal(events.filter((e) => e.type === 'token').map((e) => e.text).join(''), 'Garansi resmi berlaku 24 bulan.');
    assert.equal(events.at(-1).type, 'done');
    assert.equal(llm.state.requests.at(-1).auth, 'Bearer lokal');

    // dinonaktifkan → tidak ada sumber, tanpa memanggil LLM
    await call('PATCH', `/api/admin/knowledge/${created.id}`, { enabled: false });
    const before = llm.state.requests.filter((r) => r.url.endsWith('/chat/completions')).length;
    const off = await stream('berapa lama garansi produk?');
    assert.deepEqual(off[0].sources, []);
    assert.equal(llm.state.requests.filter((r) => r.url.endsWith('/chat/completions')).length, before);

    // validasi di jalur stream tetap berupa JSON 400
    assert.equal((await call('POST', '/api/chat/stream', { sessionId: 's1', question: ' ' }, false)).status, 400);

    // LLM mati → 502 dengan pesan generik (tanpa membocorkan detail internal)
    await call('PATCH', `/api/admin/knowledge/${created.id}`, { enabled: true });
    llm.state.failChat = 500;
    const failed = await call('POST', '/api/chat', { sessionId: 's2', question: 'berapa lama garansi produk?' }, false);
    assert.equal(failed.status, 502);
    assert.doesNotMatch(JSON.stringify(await failed.json()), /500|model belum|localhost/);

    // LLM mati saat streaming: sumber sudah terkirim, lalu event error generik (bukan stack/detail internal)
    const broken = await stream('berapa lama garansi produk?');
    assert.deepEqual(broken.map((e) => e.type), ['sources', 'error']);
    assert.equal(broken[1].message, 'Layanan model bahasa sedang tidak tersedia. Coba lagi sebentar.');
  } finally {
    await new Promise((r) => { app.server.closeAllConnections(); app.server.close(r); });
    await deps.close();
    await llm.stop();
  }
});
