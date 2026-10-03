import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeDocument } from '../src/domain/knowledge-document.js';
import { ValidationError } from '../src/domain/errors.js';
import { JsonFileKnowledgeRepository } from '../src/infrastructure/persistence/json-file-knowledge-repository.js';
import { buildApp } from '../src/composition.js';
import { createDependencies } from '../src/bootstrap.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'rahasia-test';
const seedDir = path.join(root, 'knowledge');
const publicDir = path.join(root, 'src/interface/web');

async function build(dataDir) {
  const deps = await createDependencies({ DATA_DIR: dataDir });
  return buildApp({ ...deps, seedDir, publicDir, adminToken: TOKEN });
}

test('createKnowledgeDocument memvalidasi input', () => {
  const ok = { id: '1', title: ' Judul ', content: ' isi ', createdAt: 'x', updatedAt: 'x' };
  assert.equal(createKnowledgeDocument(ok).title, 'Judul');
  assert.equal(createKnowledgeDocument(ok).enabled, true);
  assert.throws(() => createKnowledgeDocument({ ...ok, title: ' ' }), ValidationError);
  assert.throws(() => createKnowledgeDocument({ ...ok, content: '' }), ValidationError);
  assert.throws(() => createKnowledgeDocument({ ...ok, enabled: 'ya' }), ValidationError);
  assert.throws(() => createKnowledgeDocument({ ...ok, title: 'x'.repeat(121) }), ValidationError);
});

test('repository JSON menyimpan permanen dan bertahan antar instance', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rag-repo-'));
  try {
    const file = path.join(dir, 'sub', 'k.json');
    const a = new JsonFileKnowledgeRepository(file);
    await a.save(createKnowledgeDocument({ id: 'a', title: 'A', content: 'isi a', createdAt: '1', updatedAt: '1' }));
    await a.save(createKnowledgeDocument({ id: 'b', title: 'B', content: 'isi b', createdAt: '2', updatedAt: '2' }));
    assert.equal(await a.delete('zzz'), false);
    assert.equal(await a.delete('a'), true);
    const b = new JsonFileKnowledgeRepository(file);
    assert.deepEqual((await b.list()).map((d) => d.id), ['b']);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function startApp() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-app-'));
  const app = await build(dataDir);
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://localhost:${app.server.address().port}`;
  const call = (method, url, body, token = TOKEN) => fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ask = async (question) => (await call('POST', '/api/chat', { sessionId: 's1', question }, null)).json();
  const stop = async () => { await new Promise((r) => app.server.close(r)); await rm(dataDir, { recursive: true, force: true }); };
  return { call, ask, stop, app, dataDir, base };
}

test('API admin menolak tanpa/salah token', async () => {
  const { call, stop } = await startApp();
  try {
    assert.equal((await call('GET', '/api/admin/knowledge', undefined, null)).status, 401);
    assert.equal((await call('GET', '/api/admin/knowledge', undefined, 'salah')).status, 401);
    assert.equal((await call('POST', '/api/admin/knowledge', { title: 'x', content: 'y' }, 'salah')).status, 401);
    assert.equal((await call('GET', '/api/admin/knowledge')).status, 200);
  } finally { await stop(); }
});

test('seed awal terimpor dan CRUD + enable/disable langsung mempengaruhi chatbot', async () => {
  const { call, ask, stop, app } = await startApp();
  try {
    assert.equal(app.seeded, 4);
    const { items } = await (await call('GET', '/api/admin/knowledge')).json();
    assert.equal(items.length, 4);

    // create
    const created = await call('POST', '/api/admin/knowledge', { title: 'Garansi', content: 'Garansi resmi produk berlaku selama 24 bulan sejak pembelian.' });
    assert.equal(created.status, 201);
    const doc = await created.json();
    assert.equal((await ask('berapa lama garansi produk?')).sources[0].id, doc.id);

    // disable → tidak dipakai
    assert.equal((await call('PATCH', `/api/admin/knowledge/${doc.id}`, { enabled: false })).status, 200);
    assert.deepEqual((await ask('berapa lama garansi produk?')).sources, []);

    // enable + edit isi
    await call('PUT', `/api/admin/knowledge/${doc.id}`, { enabled: true, content: 'Garansi resmi produk berlaku selama 36 bulan.' });
    assert.match((await ask('berapa lama garansi produk?')).content, /36 bulan/);

    // delete
    assert.equal((await call('DELETE', `/api/admin/knowledge/${doc.id}`)).status, 204);
    assert.deepEqual((await ask('berapa lama garansi produk?')).sources, []);
    assert.equal((await call('GET', `/api/admin/knowledge/${doc.id}`)).status, 404);
    assert.equal((await call('DELETE', `/api/admin/knowledge/${doc.id}`)).status, 404);
  } finally { await stop(); }
});

test('validasi input admin dan mass-assignment diabaikan', async () => {
  const { call, stop } = await startApp();
  try {
    assert.equal((await call('POST', '/api/admin/knowledge', { title: '', content: 'x' })).status, 400);
    assert.equal((await call('POST', '/api/admin/knowledge', { title: 'x', content: '' })).status, 400);
    assert.equal((await call('POST', '/api/admin/knowledge', { title: 'x', content: 'y', enabled: 'ya' })).status, 400);
    assert.equal((await call('POST', '/api/admin/knowledge', [1])).status, 400);
    const res = await call('POST', '/api/admin/knowledge', { id: 'dibajak', title: 'T', content: 'isi', createdAt: '1999' });
    const doc = await res.json();
    assert.notEqual(doc.id, 'dibajak');
    assert.notEqual(doc.createdAt, '1999');
  } finally { await stop(); }
});

test('API uji pencarian admin: skor, ambang, dan otorisasi', async () => {
  const { call, stop } = await startApp();
  try {
    assert.equal((await call('POST', '/api/admin/search', { query: 'pengiriman' }, null)).status, 401);
    assert.equal((await call('POST', '/api/admin/search', { query: ' ' })).status, 400);
    const res = await call('POST', '/api/admin/search', { query: 'berapa lama pengiriman luar Jawa?' });
    assert.equal(res.status, 200);
    const { hits, minScore } = await res.json();
    assert.equal(minScore, 0.05);
    assert.equal(hits[0].title, 'Pengiriman & Pelacakan');
    assert.ok(hits[0].score >= minScore && hits[0].aboveThreshold);
    assert.match(hits[0].text, /luar Jawa/);
  } finally { await stop(); }
});

test('perubahan tersimpan permanen: restart app tidak mengulang seed', async () => {
  const first = await startApp();
  try {
    const items = (await (await first.call('GET', '/api/admin/knowledge')).json()).items;
    await first.call('DELETE', `/api/admin/knowledge/${items[0].id}`);
    await new Promise((r) => first.app.server.close(r));
    const again = await build(first.dataDir);
    assert.equal(again.seeded, 0);
    assert.equal(again.stats.documents, 3);
  } finally { await rm(first.dataDir, { recursive: true, force: true }); }
});

test('halaman admin dan chat dilayani statis', async () => {
  const { base, stop } = await startApp();
  try {
    for (const p of ['/', '/admin.html', '/admin.js', '/admin.css']) assert.equal((await fetch(base + p)).status, 200, p);
    assert.equal((await fetch(base + '/..%2fpackage.json')).status, 404);
  } finally { await stop(); }
});
