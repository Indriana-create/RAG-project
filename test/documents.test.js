import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationError } from '../src/domain/errors.js';
import { LIMITS } from '../src/domain/knowledge-document.js';
import { chunkDocument } from '../src/domain/chunk.js';
import { ExtractDocumentText } from '../src/application/use-cases/extract-document-text.js';
import { createDocumentTextExtractor, normalizeText } from '../src/infrastructure/documents/index.js';
import { decodeXml } from '../src/infrastructure/documents/xml.js';
import { ScryptPasswordHasher } from '../src/infrastructure/security/scrypt-password-hasher.js';
import { buildApp } from '../src/composition.js';
import { createDependencies } from '../src/bootstrap.js';
import { makeDocx, makePdf, makePptx, makeZip } from './helpers/office-fixtures.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extractor = createDocumentTextExtractor();
const extract = (filename, buffer) => extractor.extract({ filename, buffer });
const rejects = (promise, pattern) => assert.rejects(promise, (err) => err instanceof ValidationError && pattern.test(err.message));

test('xml: entitas dikenali, yang tidak dikenal dibiarkan', () => {
  assert.equal(decodeXml('A &amp; B &lt;c&gt; &quot;d&quot; &#65;&#x42; &unknown; &#0;'), 'A & B <c> "d" AB &unknown; &#0;');
});

test('normalizeText: baris baru seragam, spasi aneh dibersihkan, baris kosong beruntun diringkas', () => {
  assert.equal(normalizeText('a  \r\nb c\r\n\r\n\r\n\r\nd\u0000 \n'), 'a\nb c\n\nd');
});

test('DOCX: paragraf, tab, entitas, dan tabel menjadi teks yang rapi', async () => {
  const buffer = makeDocx(['Kebijakan Garansi & Servis', 'Masa garansi\t12 bulan', { table: [['Produk', 'Garansi'], ['Laptop', '24 bulan'], ['', '']] }, 'Penutup']);
  const result = await extract('Garansi.docx', buffer);
  assert.equal(result.format, 'DOCX');
  assert.equal(result.title, 'Garansi');
  assert.equal(result.text, 'Kebijakan Garansi & Servis\n\nMasa garansi\t12 bulan\n\nProduk | Garansi\nLaptop | 24 bulan\n\nPenutup');
});

test('DOCX: tabel bersarang dan paragraf kosong tidak merusak hasil', async () => {
  const nested = `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Luar</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Dalam</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc><w:tc><w:p/><w:p><w:r><w:t>Kanan</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const result = await extract('b.docx', makeDocx(['Awal', { raw: nested }, { raw: '<w:p/>' }, 'Akhir']));
  assert.match(result.text, /^Awal\n\nLuar Dalam \| Kanan\n\nAkhir$/);
});

test('PPTX: urutan slide mengikuti presentation.xml, catatan ikut, nomor slide dibuang', async () => {
  const buffer = makePptx([
    { paras: ['Pembuka', 'Selamat datang'], notes: ['Sapa peserta'] },
    { paras: ['Harga'] },
    { paras: ['Penutup'] },
  ], { order: [3, 1, 2] });
  const result = await extract('Deck.PPTX', buffer);
  assert.equal(result.slides, 3);
  assert.equal(result.text, '## Slide 1\nPenutup\n\n## Slide 2\nPembuka\nSelamat datang\nCatatan pembicara:\nSapa peserta\n\n## Slide 3\nHarga');
  assert.doesNotMatch(result.text, /‹#›/);
});

test('PDF: teks per halaman, baris, dan paragraf mengikuti posisi', async () => {
  const buffer = makePdf([['Judul Kebijakan Pengembalian', 'Barang dapat dikembalikan 7 hari', null, 'Refund diproses 3 hari kerja'], ['Halaman kedua berisi kontak layanan pelanggan']]);
  const result = await extract('policy.pdf', buffer);
  assert.equal(result.format, 'PDF');
  assert.equal(result.pages, 2);
  assert.equal(result.text, 'Judul Kebijakan Pengembalian\nBarang dapat dikembalikan 7 hari\n\nRefund diproses 3 hari kerja\n\nHalaman kedua berisi kontak layanan pelanggan');
});

test('PDF tanpa teks (mirip hasil scan) dan PDF rusak ditolak dengan pesan yang jelas', async () => {
  await rejects(extract('scan.pdf', makePdf([['x']])), /tidak berisi teks.*OCR/);
  await rejects(extract('rusak.pdf', Buffer.from('%PDF-1.4\nini bukan pdf yang utuh')), /tidak bisa dibaca/);
  await rejects(extract('palsu.pdf', Buffer.from('bukan pdf sama sekali')), /bukan PDF yang valid/);
});

test('teks polos: UTF-8, UTF-16 dengan BOM, judul dari heading Markdown, dan file biner ditolak', async () => {
  assert.equal((await extract('catatan.txt', Buffer.from('﻿Halo dunia — é', 'utf8'))).text, 'Halo dunia — é');
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Teks UTF-16', 'utf16le')]);
  assert.equal((await extract('u16.txt', utf16)).text, 'Teks UTF-16');
  const md = await extract('sembarang.md', Buffer.from('Intro\n\n# Panduan Pengguna\n\nIsi.'));
  assert.equal(md.title, 'Panduan Pengguna');
  assert.equal((await extract('data.csv', Buffer.from('a,b\n1,2'))).format, 'CSV');
  await rejects(extract('gambar.txt', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1])), /biner/);
  await rejects(extract('zip.txt', makeDocx(['x'])), /tidak cocok dengan ekstensinya/);
});

test('format lama dan tak dikenal ditolak dengan petunjuk', async () => {
  await rejects(extract('lama.doc', Buffer.from('x')), /DOCX/);
  await rejects(extract('lama.ppt', Buffer.from('x')), /PPTX/);
  await rejects(extract('app.exe', Buffer.from('MZ')), /belum didukung/);
  await rejects(extract('tanpa-ekstensi', Buffer.from('x')), /belum didukung/);
  await rejects(extract('palsu.docx', Buffer.from('bukan zip')), /bukan DOCX yang valid/);
});

test('arsip Office rusak, tanpa isi utama, terenkripsi, atau "zip bomb" ditolak tanpa menjatuhkan server', async () => {
  await rejects(extract('a.docx', makeZip({ 'readme.txt': 'tidak ada document.xml' })), /bukan DOCX yang valid/);
  await rejects(extract('a.pptx', makeZip({ 'ppt/other.xml': '<x/>' })), /tidak ada slide/);
  await rejects(extract('a.docx', makeZip({ 'word/document.xml': '<w:p/>' }, { flags: 1 })), /password/);
  const truncated = makeDocx(['isi']).subarray(0, 40);
  await rejects(extract('a.docx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), truncated])), /rusak|bukan/);
  // 100 MB nol terkompresi jadi sekitar 100 KB: harus berhenti di batas dekompresi, bukan memakan memori.
  const bomb = makeZip({ 'word/document.xml': Buffer.alloc(100 * 1024 * 1024) });
  assert.ok(bomb.length < 500 * 1024);
  await rejects(extract('bom.docx', bomb), /terlalu besar setelah dibuka/);
});

test('ExtractDocumentText: nama, kosong, ukuran, dan batas panjang teks', async () => {
  const use = new ExtractDocumentText({ extractor, maxBytes: 1000 });
  await rejects(use.execute({ filename: '', buffer: Buffer.from('x') }), /Nama file/);
  await rejects(use.execute({ filename: 'a.txt', buffer: Buffer.alloc(0) }), /kosong/);
  await rejects(use.execute({ filename: 'a.txt', buffer: Buffer.alloc(1001, 97) }), /terlalu besar \(maksimal/);
  await rejects(use.execute({ filename: 'a.txt', buffer: Buffer.from('   \n  ') }), /Tidak ada teks/);
  const big = new ExtractDocumentText({ extractor, maxBytes: LIMITS.fileBytes });
  await rejects(big.execute({ filename: 'b.txt', buffer: Buffer.alloc(LIMITS.content + 1, 97) }), /melebihi batas/);
  const ok = await use.execute({ filename: 'Halo.txt', buffer: Buffer.from('isi singkat') });
  assert.deepEqual(ok, { title: 'Halo', content: 'isi singkat', format: 'TXT', chars: 11 });
});

test('chunking: paragraf raksasa (mis. hasil PDF tanpa baris kosong) dipecah di kalimat, paragraf biasa tetap utuh', () => {
  const long = Array.from({ length: 80 }, (_, i) => `Kalimat nomor ${i} berisi informasi penting.`).join(' ');
  const chunks = chunkDocument({ id: 'd', title: 'T', content: long });
  assert.ok(chunks.length >= 5);
  assert.ok(chunks.every((c) => c.text.length <= 602)); // batas 600 + pemisah antarparagraf, seperti sebelumnya
  assert.equal(chunks.map((c) => c.text).join(' ').replace(/\s+/g, ' '), long);
  assert.equal(chunkDocument({ id: 'd', title: 'T', content: 'x'.repeat(2500) }).every((c) => c.text.length <= 602), true);
  const short = chunkDocument({ id: 'd', title: 'T', content: 'Paragraf satu.\n\nParagraf dua.' });
  assert.equal(short.length, 1);
  assert.equal(short[0].text, 'Paragraf satu.\n\nParagraf dua.');
});

// ---------- HTTP ----------
async function start() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-doc-'));
  const deps = await createDependencies({ DATA_DIR: dataDir });
  const app = await buildApp({
    ...deps, seedDir: path.join(root, 'knowledge'), publicDir: path.join(root, 'src/interface/web'),
    adminToken: 'token-otomasi-123', bootstrapAdmin: { username: 'admin', password: 'password-awal-1' },
    hasher: new ScryptPasswordHasher({ N: 1024 }), sessionSecret: 'rahasia-sesi-untuk-tes-dokumen',
  });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://localhost:${app.server.address().port}`;
  const auth = { authorization: 'Bearer token-otomasi-123' };
  const upload = (name, body, headers = {}) => fetch(`${base}/api/admin/knowledge/extract`, {
    method: 'POST', body, headers: { 'content-type': 'application/octet-stream', ...(name === undefined ? {} : { 'x-filename': encodeURIComponent(name) }), ...auth, ...headers },
  });
  const json = (method, url, body) => fetch(base + url, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...auth } });
  const stop = async () => { await new Promise((r) => { app.server.closeAllConnections(); app.server.close(r); }); await rm(dataDir, { recursive: true, force: true }); };
  return { base, upload, json, stop };
}

test('HTTP: unggah DOCX/PPTX/PDF/TXT lalu simpan sebagai knowledge dan ditemukan pencarian', async () => {
  const t = await start();
  try {
    const docx = await t.upload('Aturan Lembur.docx', makeDocx(['Karyawan lembur mendapat upah tambahan satu setengah kali upah per jam.']));
    assert.equal(docx.status, 200);
    const extracted = await docx.json();
    assert.equal(extracted.title, 'Aturan Lembur');
    assert.equal(extracted.format, 'DOCX');
    assert.equal(extracted.chars, extracted.content.length);

    const saved = await t.json('POST', '/api/admin/knowledge', { title: extracted.title, content: extracted.content });
    assert.equal(saved.status, 201);
    const search = await (await t.json('POST', '/api/admin/search', { query: 'upah lembur per jam' })).json();
    assert.equal(search.hits[0].title, 'Aturan Lembur');

    const pptx = await (await t.upload('Deck.pptx', makePptx([{ paras: ['Roadmap produk 2027'] }]))).json();
    assert.equal(pptx.slides, 1);
    const pdf = await (await t.upload('Panduan.pdf', makePdf([['Panduan instalasi aplikasi versi terbaru']]))).json();
    assert.equal(pdf.pages, 1);
    const txt = await (await t.upload('Catatan Rapat.txt', Buffer.from('Rapat membahas anggaran.'))).json();
    assert.equal(txt.title, 'Catatan Rapat');
  } finally { await t.stop(); }
});

test('HTTP: unggah memerlukan login/token, nama file, dan menolak file terlalu besar atau tidak valid', async () => {
  const t = await start();
  try {
    const anon = await fetch(`${t.base}/api/admin/knowledge/extract`, { method: 'POST', body: 'x', headers: { 'x-filename': 'a.txt' } });
    assert.equal(anon.status, 401);

    assert.equal((await t.upload(undefined, Buffer.from('isi'))).status, 400);          // tanpa x-filename
    assert.equal((await t.upload('%E0%A4%A', Buffer.from('isi'))).status, 400);         // nama rusak
    assert.equal((await t.upload('a.txt', Buffer.alloc(0))).status, 400);               // kosong
    const wrong = await t.upload('a.exe', Buffer.from('MZ'));
    assert.equal(wrong.status, 400);
    assert.match((await wrong.json()).error, /belum didukung/);
    const broken = await t.upload('rusak.docx', Buffer.from('bukan dokumen'));
    assert.equal(broken.status, 400);

    const tooBig = await t.upload('besar.txt', Buffer.alloc(10 * 1024 * 1024 + 1, 97));
    assert.equal(tooBig.status, 400);
    assert.match((await tooBig.json()).error, /maksimal 10 MB/);
    const justOk = await t.upload('pas.txt', Buffer.alloc(10 * 1024 * 1024, 97).fill(' ', 0, 100));
    assert.equal(justOk.status, 400); // 10 MB muat, tetapi teksnya melebihi batas karakter knowledge
    assert.match((await justOk.json()).error, /melebihi batas/);
  } finally { await t.stop(); }
});

test('HTTP: isi knowledge besar (hingga 500.000 karakter) tersimpan utuh, termasuk karakter multi-byte', async () => {
  const t = await start();
  try {
    const content = 'Café résumé naïve — ' .repeat(24_000).slice(0, 450_000); // ± 480 KB UTF-8 dengan karakter 2-3 byte
    const created = await t.json('POST', '/api/admin/knowledge', { title: 'Besar', content });
    assert.equal(created.status, 201);
    const id = (await created.json()).id;
    const back = await (await fetch(`${t.base}/api/admin/knowledge/${id}`, { headers: { authorization: 'Bearer token-otomasi-123' } })).json();
    assert.equal(back.content.length, content.trim().length);
    assert.equal(back.content, content.trim()); // tidak ada karakter rusak (�) di perbatasan potongan jaringan

    const over = await t.json('POST', '/api/admin/knowledge', { title: 'Terlalu', content: 'x'.repeat(LIMITS.content + 1) });
    assert.equal(over.status, 400);
    const huge = await t.json('POST', '/api/admin/knowledge', { title: 'Raksasa', content: 'x'.repeat(3_100_000) });
    assert.equal(huge.status, 400);
    assert.match((await huge.json()).error, /terlalu besar/);
    // Endpoint lain tetap dibatasi 1 MB.
    const chat = await t.json('POST', '/api/chat', { sessionId: 's', question: 'x'.repeat(1_100_000) });
    assert.equal(chat.status, 400);
  } finally { await t.stop(); }
});
