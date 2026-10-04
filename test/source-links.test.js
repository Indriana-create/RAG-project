import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSourceUrl } from '../src/domain/web-url.js';
import { ScryptPasswordHasher } from '../src/infrastructure/security/scrypt-password-hasher.js';
import { buildApp } from '../src/composition.js';
import { createDependencies } from '../src/bootstrap.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('findSourceUrl: baris "Sumber:" (ID/EN) diambil, yang terakhir menang, hanya http(s) yang sah', () => {
  assert.equal(findSourceUrl('Isi.\n\nSumber: https://www.contoh.co.id/dokumentasi'), 'https://www.contoh.co.id/dokumentasi');
  assert.equal(findSourceUrl('Isi\nsource:   http://contoh.co.id/a#bagian  \n'), 'http://contoh.co.id/a');
  assert.equal(findSourceUrl('Sumber: https://lama.co/x\nIsi lain\nSumber: https://baru.co/y'), 'https://baru.co/y');
  for (const bad of ['Sumber: javascript:alert(1)', 'Sumber: data:text/html,x', 'Sumber: ftp://x.co/a', 'Sumber: contoh.co.id', 'Sumber: https://user:pw@x.co/',
    'Lihat Sumber: https://x.co/di-tengah-kalimat', 'Sumber: https://', 'Tidak ada sumber', '', undefined, null]) {
    assert.equal(findSourceUrl(bad), undefined, String(bad));
  }
  assert.equal(findSourceUrl('Sumber: javascript:alert(1)\nSumber: https://aman.co/a'), 'https://aman.co/a');
});

test('chat: sumber yang punya "Sumber: URL" membawa url (stream dan non-stream), yang tidak punya tidak', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-src-'));
  const deps = await createDependencies({ DATA_DIR: dataDir });
  const app = await buildApp({
    ...deps, seedDir: path.join(root, 'knowledge'), seed: false, publicDir: path.join(root, 'src/interface/web'),
    adminToken: 'token-otomasi-123', bootstrapAdmin: { username: 'admin', password: 'password-awal-1' }, hasher: new ScryptPasswordHasher({ N: 1024 }),
  });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://localhost:${app.server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer token-otomasi-123' }, body: JSON.stringify(body) });
  try {
    await post('/api/admin/knowledge', { title: 'Dokumentasi Kegiatan', content: 'Dokumentasi kegiatan dan momen berharga perusahaan tersedia untuk umum.\n\nSumber: https://www.contoh.co.id/id/documentation' });
    await post('/api/admin/knowledge', { title: 'Agenda Event', content: 'Agenda event tahunan perusahaan diumumkan setiap awal tahun.' });
    await post('/api/admin/knowledge', { title: 'Berbahaya', content: 'Materi berbahaya tentang peretasan perangkat.\n\nSumber: javascript:alert(document.cookie)' });

    const chat = await (await post('/api/chat', { sessionId: 's1', question: 'dokumentasi kegiatan dan momen berharga' })).json();
    const doc = chat.sources.find((s) => s.title === 'Dokumentasi Kegiatan');
    assert.equal(doc.url, 'https://www.contoh.co.id/id/documentation');

    const agenda = await (await post('/api/chat', { sessionId: 's2', question: 'agenda event tahunan' })).json();
    assert.equal(agenda.sources[0].title, 'Agenda Event');
    assert.ok(!('url' in agenda.sources[0]));

    const bad = await (await post('/api/chat', { sessionId: 's3', question: 'materi berbahaya peretasan perangkat' })).json();
    assert.equal(bad.sources[0].title, 'Berbahaya');
    assert.ok(!('url' in bad.sources[0])); // javascript: tidak pernah diteruskan ke klien

    const stream = await post('/api/chat/stream', { sessionId: 's4', question: 'dokumentasi kegiatan dan momen berharga' });
    const events = (await stream.text()).split('\n\n').filter((b) => b.startsWith('data:')).map((b) => JSON.parse(b.slice(5)));
    assert.equal(events.find((e) => e.type === 'sources').sources.find((s) => s.title === 'Dokumentasi Kegiatan').url, 'https://www.contoh.co.id/id/documentation');
    assert.equal(events.find((e) => e.type === 'done').message.sources.find((s) => s.title === 'Dokumentasi Kegiatan').url, 'https://www.contoh.co.id/id/documentation');

    // Riwayat percakapan juga membawa url, jadi chip tetap bisa diklik setelah halaman dimuat ulang.
    const history = await (await fetch(`${base}/api/history/s1`)).json();
    assert.equal(history.at(-1).sources.find((s) => s.title === 'Dokumentasi Kegiatan').url, 'https://www.contoh.co.id/id/documentation');
  } finally {
    await new Promise((r) => { app.server.closeAllConnections(); app.server.close(r); });
    await rm(dataDir, { recursive: true, force: true });
  }
});
