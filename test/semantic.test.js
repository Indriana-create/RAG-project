import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { retryUpstream } from '../src/infrastructure/llm/retry.js';
import { UpstreamError } from '../src/domain/errors.js';
import { AskQuestion } from '../src/application/use-cases/ask-question.js';
import { InMemoryChatHistory } from '../src/infrastructure/persistence/in-memory-chat-history.js';
import { analyze, parseQuestions } from '../scripts/lib/calibration.js';
import { buildApp } from '../src/composition.js';
import { createDependencies } from '../src/bootstrap.js';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('retryUpstream: mengulang hanya kegagalan layanan luar dan menyerah setelah batas', async () => {
  let calls = 0;
  const waits = [];
  const flaky = async () => { calls++; if (calls < 3) throw new UpstreamError(`belum siap ${calls}`); return 'siap'; };
  assert.equal(await retryUpstream(flaky, { attempts: 5, delayMs: 7, sleep: async (ms) => waits.push(ms), onRetry: () => {} }), 'siap');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [7, 7]);

  calls = 0;
  await assert.rejects(retryUpstream(async () => { calls++; throw new UpstreamError('mati'); }, { attempts: 3, sleep: async () => {} }), /mati/);
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(retryUpstream(async () => { calls++; throw new Error('salah konfigurasi'); }, { attempts: 5, sleep: async () => {} }), /salah konfigurasi/);
  assert.equal(calls, 1); // bukan kegagalan layanan luar: tidak diulang
});

test('sapaan/basa-basi tidak memicu pencarian; huruf non-Latin tetap dicari (untuk model multibahasa)', async () => {
  const queries = [];
  const retriever = { search: async (q) => { queries.push(q); return []; } };
  const ask = new AskQuestion({ retriever, answerGenerator: { generate: async () => 'ok' }, history: new InMemoryChatHistory() });
  for (const talk of ['Halo kak', 'terima kasih ya', 'Selamat pagi!', 'kamu siapa?', '???']) await ask.execute({ sessionId: 's', question: talk });
  assert.deepEqual(queries, []);

  // sesi berbeda agar tidak memicu pencarian ulang untuk pertanyaan lanjutan
  await ask.execute({ sessionId: 'a', question: '你们的退货政策是什么？' });
  await ask.execute({ sessionId: 'b', question: 'ما هي سياسة الإرجاع؟' });
  await ask.execute({ sessionId: 'c', question: 'jam buka toko?' });
  assert.deepEqual(queries, ['你们的退货政策是什么？', 'ما هي سياسة الإرجاع؟', 'jam buka toko?']);
});

test('analyze: ambang di tengah celah bila terpisah; mengutamakan tidak menolak pertanyaan sah bila tumpang tindih', () => {
  const row = (relevant, top, question = `${relevant}${top}`) => ({ relevant, top, question });
  const clean = analyze([row(true, 0.82), row(true, 0.74), row(false, 0.58), row(false, 0.61)]);
  assert.equal(clean.separable, true);
  assert.equal(clean.margin, 0.13);
  assert.equal(clean.threshold, 0.68);
  assert.deepEqual([clean.missed.length, clean.leaked.length], [0, 0]);

  // satu pertanyaan sah (0.55) lebih rendah dari satu tak-relevan (0.62): menolak yang sah 2x lebih mahal
  const overlap = analyze([row(true, 0.9), row(true, 0.55), row(false, 0.62), row(false, 0.4)]);
  assert.equal(overlap.separable, false);
  assert.ok(overlap.threshold <= 0.55, `ambang ${overlap.threshold} tidak boleh menolak pertanyaan sah`);
  assert.equal(overlap.leaked.length, 1);
  assert.equal(overlap.missed.length, 0);

  assert.throws(() => analyze([row(true, 0.8)]), /minimal satu/);
});

test('parseQuestions: format +/-, komentar dan baris kosong diabaikan, format salah ditolak', () => {
  const rows = parseQuestions('# komentar\n\n+ Berapa lama kirim?\n  - Siapa presiden?  \n');
  assert.deepEqual(rows, [{ relevant: true, question: 'Berapa lama kirim?' }, { relevant: false, question: 'Siapa presiden?' }]);
  assert.throws(() => parseQuestions('tanpa tanda'), /diawali "\+" atau "-"/);
});

test('skrip calibrate.mjs berjalan terhadap aplikasi hidup dan memberi rekomendasi MIN_SCORE', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rag-cal-'));
  const deps = await createDependencies({ DATA_DIR: dir });
  const app = await buildApp({
    ...deps, seedDir: path.join(root, 'knowledge'), publicDir: path.join(root, 'src/interface/web'),
    adminToken: 'token-kalibrasi-123', bootstrapAdmin: { username: 'admin', password: 'password-uji-1' },
  });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://localhost:${app.server.address().port}`;
  try {
    const file = path.join(dir, 'q.txt');
    await writeFile(file, '+ Berapa lama pengiriman ke luar Jawa?\n+ Bagaimana cara refund barang?\n- Siapa presiden Mars?\n- resep rendang\n');
    const env = { ...process.env, ADMIN_TOKEN: 'token-kalibrasi-123' };
    const { stdout } = await run('node', [path.join(root, 'scripts/calibrate.mjs'), base, file], { env });
    assert.match(stdout, /Skor teratas tiap pertanyaan/);
    assert.match(stdout, /Rekomendasi:\s+MIN_SCORE=0\.\d+/);
    assert.match(stdout, /Terpisah dengan jelas/);

    await assert.rejects(run('node', [path.join(root, 'scripts/calibrate.mjs'), base, file], { env: { ...process.env, ADMIN_TOKEN: 'salah' } }), /401/);
    await assert.rejects(run('node', [path.join(root, 'scripts/calibrate.mjs')], { env }), (e) => e.code === 2);
  } finally {
    await new Promise((r) => { app.server.closeAllConnections(); app.server.close(r); });
    await rm(dir, { recursive: true, force: true });
  }
});
