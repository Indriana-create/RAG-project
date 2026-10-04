import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChunk } from '../src/domain/chunk.js';
import { AskQuestion } from '../src/application/use-cases/ask-question.js';
import { InMemoryChatHistory } from '../src/infrastructure/persistence/in-memory-chat-history.js';
import { TfidfRetriever } from '../src/infrastructure/retrieval/tfidf-retriever.js';
import { createDependencies } from '../src/bootstrap.js';
import { buildApp } from '../src/composition.js';
import { buildPrompt } from '../src/infrastructure/llm/prompt.js';
import { ScryptPasswordHasher } from '../src/infrastructure/security/scrypt-password-hasher.js';
import { startFakeLlm } from './helpers/fake-llm.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chunk = (documentId, index, text, title = documentId) => createChunk({ documentId, title, index, text });

test('TfidfRetriever.neighbors: chunk bertetangga (±1) pada dokumen yang sama, tanpa chunk itu sendiri', async () => {
  const r = new TfidfRetriever();
  await r.index([chunk('a', 0, 'alfa'), chunk('a', 1, 'beta'), chunk('a', 2, 'gamma'), chunk('a', 3, 'delta'), chunk('b', 0, 'sigma'), chunk('b', 1, 'omega')]);
  assert.deepEqual((await r.neighbors([chunk('a', 1, 'beta')])).map((c) => c.id).sort(), ['a#0', 'a#2']);
  assert.deepEqual((await r.neighbors([chunk('a', 0, 'alfa'), chunk('b', 1, 'omega')])).map((c) => c.id).sort(), ['a#1', 'b#0']);
  assert.deepEqual((await r.neighbors([chunk('a', 1, 'beta')], { radius: 2 })).map((c) => c.id).sort(), ['a#0', 'a#2', 'a#3']);
  assert.deepEqual(await r.neighbors([]), []);
});

test('AskQuestion: konteks = chunk cocok + tetangga, urut baca; sumber tidak ganda; topK bawaan 6; batas total teks', async () => {
  const docA = (i, text = `isi ${i}`) => chunk('A', i, text, 'Daftar Pembicara');
  const calls = [];
  const retriever = {
    search: async (query, topK) => { calls.push({ query, topK }); return [{ chunk: docA(4), score: 0.9 }, { chunk: chunk('B', 1, 'lain', 'Dokumen B'), score: 0.8 }, { chunk: docA(1), score: 0.7 }]; },
    neighbors: async () => [docA(0), docA(2), docA(3), docA(5), chunk('B', 0, 'awal b', 'Dokumen B'), docA(1)],
  };
  let received;
  const generator = { generate: async (input) => { received = input; return 'ok'; } };
  const ask = new AskQuestion({ retriever, answerGenerator: generator, history: new InMemoryChatHistory(), minScore: 0.1 });
  const reply = await ask.execute({ sessionId: 's', question: 'siapa saja pembicara?' });

  assert.equal(calls[0].topK, 6);
  // Dokumen dengan kecocokan terbaik (A) lebih dulu; di dalam dokumen berurut menurut posisinya; tanpa duplikat.
  assert.deepEqual(received.contexts.map((c) => c.id), ['A#0', 'A#1', 'A#2', 'A#3', 'A#4', 'A#5', 'B#0', 'B#1']);
  assert.deepEqual(reply.sources.map((s) => s.id), ['A', 'B']);

  // Chunk tetangga hanya ditambahkan selama muat dalam batas; chunk yang cocok selalu ikut.
  const big = 'x'.repeat(2500);
  const bounded = new AskQuestion({
    retriever: { search: async () => [{ chunk: chunk('A', 2, 'inti'), score: 0.9 }], neighbors: async () => [chunk('A', 1, big), chunk('A', 3, big), chunk('A', 4, big)] },
    answerGenerator: generator, history: new InMemoryChatHistory(), minScore: 0.1,
  });
  await bounded.execute({ sessionId: 's2', question: 'pertanyaan panjang apa saja' });
  assert.deepEqual(received.contexts.map((c) => c.id), ['A#1', 'A#2', 'A#3']); // 2 tetangga muat (4 + 2500 + 2500), yang ketiga melebihi 6000

  // topK dapat diatur; retriever tanpa neighbors() tetap berfungsi seperti sebelumnya.
  const plain = new AskQuestion({ retriever: { search: async (q, k) => { calls.push({ k }); return [{ chunk: chunk('A', 0, 'satu'), score: 0.9 }]; } }, answerGenerator: generator, history: new InMemoryChatHistory(), topK: 9, minScore: 0.1 });
  await plain.execute({ sessionId: 's3', question: 'apa itu satu' });
  assert.equal(calls.at(-1).k, 9);
  assert.deepEqual(received.contexts.map((c) => c.id), ['A#0']);
});

test('prompt: aturan menyebut SEMUA butir daftar yang ada pada informasi resmi', () => {
  const { system } = buildPrompt({ question: 'siapa saja?', contexts: [chunk('A', 0, 'Nama satu, nama dua')] });
  assert.match(system, /sebutkan SEMUA butir yang tertulis/);
  assert.match(system, /hanya menyebut yang ada pada informasi yang tersedia/);
});

test('RETRIEVAL_TOP_K: bawaan 6, dapat diatur 1-12, nilai lain ditolak dengan pesan jelas', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-topk-'));
  try {
    assert.equal((await createDependencies({ DATA_DIR: dataDir })).topK, 6);
    assert.equal((await createDependencies({ DATA_DIR: dataDir, RETRIEVAL_TOP_K: '8' })).topK, 8);
    for (const bad of ['0', '13', '2.5', 'abc', '-1']) {
      await assert.rejects(createDependencies({ DATA_DIR: dataDir, RETRIEVAL_TOP_K: bad }), /RETRIEVAL_TOP_K harus bilangan bulat 1-12/, bad);
    }
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('end-to-end: daftar 9 orang yang tersebar di banyak chunk seluruhnya sampai ke LLM (bukan hanya 3 chunk)', async () => {
  const people = ['Dhiya Fakhar Nafi', 'Indriana Noviyanti', 'Yogi Indra Gunawan', 'Fadli Hamsani', 'Meyliana Surya', 'Meidy Mahardika', 'Rina Aprilia', 'Budi Santoso', 'Citra Lestari'];
  const content = people.map((name) => `${name} adalah praktisi teknologi dan pakar transformasi digital. ${'Pengalaman panjang di bidang industri, konsultasi, dan pengembangan produk digital untuk berbagai perusahaan. '.repeat(3)}`).join('\n\n');
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-list-'));
  const llm = await startFakeLlm({ reply: () => 'Berikut daftarnya.' });
  const deps = await createDependencies({ DATA_DIR: dataDir, LLM_BASE_URL: llm.baseUrl, LLM_MODEL: 'm' });
  const app = await buildApp({
    ...deps, seed: false, seedDir: path.join(root, 'knowledge'), publicDir: path.join(root, 'src/interface/web'),
    adminToken: 'token-otomasi-123', bootstrapAdmin: { username: 'admin', password: 'password-awal-1' }, hasher: new ScryptPasswordHasher({ N: 1024 }),
  });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://localhost:${app.server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer token-otomasi-123' }, body: JSON.stringify(body) });
  try {
    await post('/api/admin/knowledge', { title: 'Pembicara IDSpeaker', content });
    const reply = await (await post('/api/chat', { sessionId: 's', question: 'Siapa saja praktisi teknologi dan pakar transformasi digital?' })).json();
    assert.equal(reply.sources.length, 1);
    const sent = llm.state.requests.filter((r) => r.url.endsWith('/chat/completions')).at(-1).body.messages.at(-1).content;
    for (const name of people) assert.ok(sent.includes(name), `${name} harus ada di konteks yang dikirim ke LLM`);
    assert.ok(sent.length < 7000);
  } finally {
    await new Promise((r) => { app.server.closeAllConnections(); app.server.close(r); });
    await llm.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});
