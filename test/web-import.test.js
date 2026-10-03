import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { ValidationError } from '../src/domain/errors.js';
import { LIMITS } from '../src/domain/knowledge-document.js';
import { parseWebUrl, pickSiteLinks } from '../src/domain/web-url.js';
import { isPublicAddress, PERMISSIVE_POLICY, STRICT_POLICY } from '../src/infrastructure/web/address-policy.js';
import { extractLinks, htmlToText } from '../src/infrastructure/web/html.js';
import { SafeFetcher } from '../src/infrastructure/web/safe-fetcher.js';
import { WebPageReader } from '../src/infrastructure/web/web-page-reader.js';
import { createDocumentTextExtractor } from '../src/infrastructure/documents/index.js';
import { CrawlWebsite, ImportKnowledgeFromUrl } from '../src/application/use-cases/import-from-url.js';
import { ScryptPasswordHasher } from '../src/infrastructure/security/scrypt-password-hasher.js';
import { buildApp } from '../src/composition.js';
import { createDependencies } from '../src/bootstrap.js';
import { makeDocx, makePdf } from './helpers/office-fixtures.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rejects = (promise, pattern) => assert.rejects(promise, (err) => err instanceof ValidationError && pattern.test(err.message), String(pattern));

/** Situs uji di 127.0.0.1. `routes[path] = (req, res) => ...` atau objek {status, headers, body}. */
async function site(routes) {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    const route = routes[pathname];
    if (!route) { res.writeHead(404, { 'content-type': 'text/plain' }).end('tidak ada'); return; }
    if (typeof route === 'function') return route(req, res);
    res.writeHead(route.status ?? 200, { 'content-type': 'text/html; charset=utf-8', ...route.headers }).end(route.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { port, url: (p = '/') => `http://127.0.0.1:${port}${p}`, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}
const page = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const LOCAL_ONLY = { address: (ip) => ip === '127.0.0.1', port: () => true };

// ---------- Kebijakan alamat ----------
test('kebijakan alamat: hanya internet publik; privat, loopback, link-local, CGNAT, multicast, dan IPv6 tertanam ditolak', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '172.15.255.255', '2606:4700:4700::1111', '2a00:1450:4001::200e']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
  for (const ip of [
    '127.0.0.1', '127.255.255.254', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.255',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:db8::1',
    'bukan-ip', '', '1.2.3', '1.2.3.4.5',
  ]) assert.equal(isPublicAddress(ip), false, ip);
});

test('parseWebUrl: skema bawaan https, hanya http(s), tanpa kredensial, fragmen dibuang', () => {
  assert.equal(parseWebUrl('contoh.co.id/tentang#sejarah').toString(), 'https://contoh.co.id/tentang');
  assert.equal(parseWebUrl('  HTTP://Contoh.co.id/A  ').toString(), 'http://contoh.co.id/A');
  for (const bad of ['', '   ', undefined, 'ftp://x.co/a', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'https://user:pw@x.co/', 'https://', `https://x.co/${'a'.repeat(2100)}`]) {
    assert.throws(() => parseWebUrl(bad), ValidationError, String(bad).slice(0, 30));
  }
});

test('pickSiteLinks: situs yang sama (www setara), tanpa duplikat, tanpa media/dokumen/akun, dengan batas', () => {
  const links = [
    'https://www.contoh.co.id/', 'https://contoh.co.id/produk/', 'https://contoh.co.id/produk#harga', 'https://contoh.co.id/produk',
    'https://contoh.co.id/logo.png', 'https://contoh.co.id/brosur.pdf', 'https://contoh.co.id/login', 'https://contoh.co.id/cart/',
    'https://lain.co.id/halaman', 'mailto:a@b.co', 'https://contoh.co.id/tentang', 'https://contoh.co.id/kontak', 'https://contoh.co.id/blog?id=2',
  ];
  assert.deepEqual(pickSiteLinks(links, 'https://contoh.co.id/', 10), [
    'https://contoh.co.id/produk/', 'https://contoh.co.id/tentang', 'https://contoh.co.id/kontak', 'https://contoh.co.id/blog?id=2',
  ]);
  assert.equal(pickSiteLinks(links, 'https://contoh.co.id/', 2).length, 2);
});

// ---------- HTML ----------
test('HTML: judul, daftar, tabel, entitas; skrip/gaya/navigasi/footer dibuang; <main> diutamakan', () => {
  const body = `<nav><a href="/">Beranda</a> <a href="/produk">Produk</a></nav>
    <main><h1>Tentang <b>Lumicore</b></h1><p>Kami &amp; tim membangun AI.<br>Sejak 2020 &mdash; 100+ klien &#169;.</p>
    <ul><li>Konsultasi</li><li>Pengembangan</li></ul>
    <table><tr><th>Paket</th><th>Harga</th></tr><tr><td>Basic</td><td>Rp 1.000.000</td></tr></table>
    <h2>Kontak</h2><p>Email <a href="mailto:a@b.co">a@b.co</a></p><p>${'Isi tambahan yang cukup panjang. '.repeat(8)}</p>
    <script>var rahasia = "jangan tampil";</script><style>.x{color:red}</style></main><footer>Hak cipta 2026</footer>`;
  const { title, text } = htmlToText(page('Tentang Kami | Lumicore', body));
  assert.equal(title, 'Tentang Kami | Lumicore');
  assert.match(text, /^# Tentang Lumicore\n\nKami & tim membangun AI\.\nSejak 2020 — 100\+ klien ©\.\n\n- Konsultasi\n- Pengembangan\n\nPaket \| Harga\nBasic \| Rp 1\.000\.000\n\n## Kontak\n\nEmail a@b\.co/);
  assert.doesNotMatch(text, /Beranda|Hak cipta|rahasia|color:red/);
});

test('HTML: tanpa <main> memakai badan halaman tanpa navigasi/form; judul dari og:title atau h1; komentar dibuang', () => {
  const html = `<html><head><meta property="og:title" content="Judul &amp; OG"></head><body><!-- rahasia komentar -->
    <header><nav>Menu</nav></header><div class="x"><h2>Layanan</h2><p>Kami melayani seluruh Indonesia.</p></div>
    <form><input name="q"><button>Cari</button></form><aside>Iklan</aside></body></html>`;
  const { title, text } = htmlToText(html);
  assert.equal(title, 'Judul & OG');
  assert.match(text, /## Layanan\n\nKami melayani seluruh Indonesia\./);
  assert.doesNotMatch(text, /Menu|Cari|Iklan|rahasia/);
  assert.equal(htmlToText('<html><body><h1>Hanya H1</h1><p>x</p></body></html>').title, 'Hanya H1');
  assert.equal(htmlToText('').text, '');
});

test('HTML: tautan diubah absolut (termasuk <base>), tautan non-halaman diabaikan, entitas pada href didekode', () => {
  const html = `<base href="/blog/"><a href="post-1">A</a> <a href='/kontak?x=1&amp;y=2'>B</a> <a href="https://lain.co/x">C</a>
    <a href="#atas">D</a> <a href="mailto:a@b.co">E</a> <a href="javascript:void(0)">F</a> <a href="tel:+62">G</a> <a href=tanpa-kutip>H</a>`;
  assert.deepEqual(extractLinks(html, 'https://contoh.co.id/index.html'), [
    'https://contoh.co.id/blog/post-1', 'https://contoh.co.id/kontak?x=1&y=2', 'https://lain.co/x', 'https://contoh.co.id/blog/tanpa-kutip',
  ]);
});

// ---------- Pengambil halaman aman ----------
test('SafeFetcher: alamat internal diblokir (loopback, privat, metadata cloud, IP desimal/heks, IPv6) dan port non-web', async () => {
  const s = await site({ '/': { body: page('Rahasia', '<p>layanan internal</p>') } });
  const strict = new SafeFetcher({ policy: { address: isPublicAddress, port: () => true } }); // alamat ketat, port bebas agar yang diuji murni alamat
  try {
    for (const url of [
      s.url('/'), `http://localhost:${s.port}/`, `http://[::1]:${s.port}/`, 'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/admin', 'http://192.168.18.22:3100/', 'http://100.64.0.9/', `http://2130706433:${s.port}/`, `http://0x7f.0.0.1:${s.port}/`,
      `http://017700000001:${s.port}/`, `http://[::ffff:127.0.0.1]:${s.port}/`, `http://[::ffff:7f00:1]:${s.port}/`, 'http://0.0.0.0/',
    ]) await rejects(strict.fetch(url), /tidak diizinkan/, url);
  } finally { await s.close(); }
  await rejects(new SafeFetcher().fetch('http://example.com:22/'), /Port .* tidak diizinkan/);
  await rejects(new SafeFetcher().fetch('http://127.0.0.1:11434/api/tags'), /tidak diizinkan/);
  await rejects(new SafeFetcher().fetch('ftp://example.com/'), /Hanya alamat http/);
  assert.deepEqual([STRICT_POLICY.port(443), STRICT_POLICY.port(22), PERMISSIVE_POLICY.port(22)], [true, false, true]);
});

test('SafeFetcher: nama situs yang diresolusi ke alamat privat ditolak; alamat campuran hanya memakai yang lolos', async () => {
  const s = await site({ '/': { body: page('OK', '<p>halo</p>') } });
  try {
    const toPrivate = new SafeFetcher({ policy: { address: isPublicAddress, port: () => true }, lookup: (h, o, cb) => cb(null, [{ address: '192.168.1.5', family: 4 }]) });
    await rejects(toPrivate.fetch(`http://intranet.test:${s.port}/`), /tidak diizinkan/);

    // DNS-rebinding: nama menghasilkan dua alamat; hanya 127.0.0.1 yang lolos kebijakan, 127.0.0.2 tidak boleh dipakai.
    const mixed = new SafeFetcher({ policy: LOCAL_ONLY, lookup: (h, o, cb) => cb(null, [{ address: '127.0.0.2', family: 4 }, { address: '127.0.0.1', family: 4 }]) });
    const ok = await mixed.fetch(`http://rebind.test:${s.port}/`);
    assert.equal(ok.status, 200);

    const missing = new SafeFetcher({ policy: LOCAL_ONLY, lookup: (h, o, cb) => cb(Object.assign(new Error('x'), { code: 'ENOTFOUND' })) });
    await rejects(missing.fetch('http://tidak-ada.test/'), /tidak ditemukan/);
  } finally { await s.close(); }
});

test('SafeFetcher: pengalihan diperiksa ulang di setiap lompatan, relatif diikuti, loop dan skema berbahaya ditolak', async () => {
  const s = await site({
    '/awal': { status: 302, headers: { location: '/tujuan' }, body: '' },
    '/tujuan': { body: page('Tujuan', '<p>sampai</p>') },
    '/ke-internal': (req, res) => res.writeHead(302, { location: `http://127.0.0.2:${s.port}/` }).end(),
    '/ke-file': { status: 302, headers: { location: 'file:///etc/passwd' }, body: '' },
    '/ke-metadata': { status: 301, headers: { location: 'http://169.254.169.254/latest/' }, body: '' },
    '/loop': { status: 302, headers: { location: '/loop' }, body: '' },
    '/tanpa-lokasi': { status: 302, body: '' },
  });
  const fetcher = new SafeFetcher({ policy: LOCAL_ONLY });
  try {
    const ok = await fetcher.fetch(s.url('/awal'));
    assert.equal(ok.url, s.url('/tujuan'));
    assert.match(ok.body.toString(), /sampai/);
    await rejects(fetcher.fetch(s.url('/ke-internal')), /tidak diizinkan/);
    await rejects(fetcher.fetch(s.url('/ke-file')), /alamat yang tidak valid/);
    await rejects(fetcher.fetch(s.url('/ke-metadata')), /tidak diizinkan/);
    await rejects(fetcher.fetch(s.url('/loop')), /Terlalu banyak pengalihan/);
    await rejects(fetcher.fetch(s.url('/tanpa-lokasi')), /status 302/);
  } finally { await s.close(); }
});

test('SafeFetcher: gzip/br didekode, batas ukuran (termasuk setelah dekompresi), waktu, status galat, dan koneksi gagal', async () => {
  const text = page('Besar', `<p>${'kata '.repeat(200)}</p>`);
  const s = await site({
    '/gzip': (req, res) => res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }).end(gzipSync(text)),
    '/br': (req, res) => res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'br' }).end(brotliCompressSync(text)),
    '/bomb': (req, res) => res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }).end(gzipSync(Buffer.alloc(30 * 1024 * 1024, 97))),
    '/besar': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.write(Buffer.alloc(3 * 1024 * 1024, 97)); res.end(Buffer.alloc(3 * 1024 * 1024, 97)); },
    '/lambat': () => { /* tidak pernah membalas */ },
    '/aneh': (req, res) => res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'compress' }).end('x'),
  });
  const fetcher = new SafeFetcher({ policy: LOCAL_ONLY, maxBytes: 5 * 1024 * 1024, timeoutMs: 300 });
  try {
    assert.equal((await fetcher.fetch(s.url('/gzip'))).body.toString(), text);
    assert.equal((await fetcher.fetch(s.url('/br'))).body.toString(), text);
    await rejects(fetcher.fetch(s.url('/bomb')), /terlalu besar/);
    await rejects(fetcher.fetch(s.url('/besar')), /terlalu besar/);
    await rejects(fetcher.fetch(s.url('/lambat')), /terlalu lama/);
    await rejects(fetcher.fetch(s.url('/aneh')), /pengkodean/);
    await rejects(fetcher.fetch(s.url('/tidak-ada')), /status 404/);
  } finally { await s.close(); }
  await rejects(new SafeFetcher({ policy: LOCAL_ONLY }).fetch(`http://127.0.0.1:${s.port}/`), /tidak bisa dijangkau/);
  const controller = new AbortController();
  const slow = await site({ '/lambat': () => {} });
  try {
    const pending = new SafeFetcher({ policy: LOCAL_ONLY, timeoutMs: 5000 }).fetch(slow.url('/lambat'), { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending, (err) => err.name === 'AbortError');
  } finally { await slow.close(); }
});

// ---------- Pembaca halaman ----------
test('WebPageReader: HTML (charset header & meta), teks, PDF, DOCX tanpa tipe jelas, dan tipe tak didukung', async () => {
  const latin1 = Buffer.from(page('Café', '<main><p>Café résumé di toko kami, buka setiap hari dari pagi sampai malam. Kunjungi kami segera.</p></main>'), 'latin1');
  const metaOnly = Buffer.from(`<html><head><meta charset="iso-8859-1"><title>Meta</title></head><body><p>Pâtisserie spécialité de la maison pour semua pelanggan setia.</p></body></html>`, 'latin1');
  const s = await site({
    '/latin1': { headers: { 'content-type': 'text/html; charset=iso-8859-1' }, body: latin1 },
    '/meta': { headers: { 'content-type': 'text/html' }, body: metaOnly },
    '/catatan.txt': { headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'Catatan polos untuk knowledge.' },
    '/panduan.pdf': { headers: { 'content-type': 'application/pdf' }, body: makePdf([['Panduan layanan pelanggan edisi terbaru']]) },
    '/dok/Aturan%20Cuti.docx': { headers: { 'content-type': 'application/octet-stream' }, body: makeDocx(['Cuti tahunan dua belas hari kerja setiap tahun.']) },
    '/gambar': { headers: { 'content-type': 'image/png' }, body: Buffer.from([0x89, 0x50]) },
  });
  const reader = new WebPageReader({ fetcher: new SafeFetcher({ policy: LOCAL_ONLY }), documentExtractor: createDocumentTextExtractor() });
  try {
    const a = await reader.read(s.url('/latin1'));
    assert.equal(a.format, 'WEB');
    assert.match(a.text, /Café résumé/);
    assert.equal(a.title, 'Café');
    assert.match((await reader.read(s.url('/meta'))).text, /Pâtisserie spécialité/);
    assert.deepEqual(await reader.read(s.url('/catatan.txt')).then((r) => [r.format, r.text]), ['TXT', 'Catatan polos untuk knowledge.']);
    const pdf = await reader.read(s.url('/panduan.pdf'));
    assert.deepEqual([pdf.format, pdf.title], ['PDF', 'panduan']);
    assert.match(pdf.text, /Panduan layanan pelanggan/);
    const docx = await reader.read(s.url('/dok/Aturan%20Cuti.docx'));
    assert.deepEqual([docx.format, docx.title], ['DOCX', 'Aturan Cuti']);
    await rejects(reader.read(s.url('/gambar')), /belum didukung/);
  } finally { await s.close(); }
});

// ---------- Use case ----------
test('ImportKnowledgeFromUrl: menambahkan sumber, menolak halaman kosong (SPA) dan yang terlalu panjang', async () => {
  const long = `<main><p>${'x'.repeat(LIMITS.content + 10)}</p></main>`;
  const s = await site({
    '/ok': { body: page('Profil Perusahaan', '<main><h1>Profil</h1><p>Lumicore adalah perusahaan teknologi kecerdasan buatan di Indonesia.</p></main>') },
    '/spa': { body: '<html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>' },
    '/panjang': { body: page('Panjang', long) },
  });
  const use = new ImportKnowledgeFromUrl({ reader: new WebPageReader({ fetcher: new SafeFetcher({ policy: LOCAL_ONLY }), documentExtractor: createDocumentTextExtractor() }) });
  try {
    const ok = await use.execute({ url: s.url('/ok') });
    assert.equal(ok.title, 'Profil Perusahaan');
    assert.equal(ok.format, 'WEB');
    assert.ok(ok.content.endsWith(`Sumber: ${s.url('/ok')}`));
    assert.equal(ok.chars, ok.content.length);
    await rejects(use.execute({ url: s.url('/spa') }), /JavaScript/);
    await rejects(use.execute({ url: s.url('/panjang') }), /melebihi batas/);
    await rejects(use.execute({ url: '' }), /wajib diisi/);
  } finally { await s.close(); }
});

test('CrawlWebsite: halaman awal + tautan situs yang sama, tanpa duplikat/media/situs lain, judul kembar dibedakan, galat dilaporkan', async () => {
  const p = (t, n) => page(t, `<main><h1>${t}</h1><p>${'Isi halaman '.repeat(n)}${t}.</p></main>`);
  const s = await site({
    '/': { body: page('Beranda', `<nav><a href="/tentang">T</a><a href="/produk/">P</a><a href="/produk#x">P2</a><a href="/kontak">K</a><a href="/logo.png">L</a><a href="/login">Login</a><a href="/rusak">R</a><a href="/sama">S</a><a href="/kembar-1">K1</a><a href="/kembar-2">K2</a><a href="https://lain.co.id/x">X</a></nav><main><p>${'Selamat datang di situs kami. '.repeat(5)}</p></main>`) },
    '/tentang': { body: p('Tentang', 6) },
    '/produk/': { body: p('Produk', 6) },
    '/kontak': { body: p('Kontak', 6) },
    '/sama': { body: p('Tentang', 6) },
    '/kembar-1': { body: page('Layanan', '<main><p>Layanan satu: konsultasi dan implementasi sistem.</p></main>') },
    '/kembar-2': { body: page('Layanan', '<main><p>Layanan dua: pelatihan dan dukungan teknis berkelanjutan.</p></main>') },
  });
  const reader = new WebPageReader({ fetcher: new SafeFetcher({ policy: LOCAL_ONLY }), documentExtractor: createDocumentTextExtractor() });
  try {
    const result = await new CrawlWebsite({ reader }).execute({ url: s.url('/') });
    assert.deepEqual(result.pages.map((x) => x.title), ['Beranda', 'Tentang', 'Produk', 'Kontak', 'Layanan', `Layanan — /kembar-2`]);
    assert.ok(result.pages.every((x) => x.content.endsWith(`Sumber: ${x.url}`)));
    assert.equal(result.partial, false);
    assert.deepEqual(result.skipped.map((x) => [new URL(x.url).pathname, x.reason]).sort(), [
      ['/rusak', 'Halaman tidak bisa dibuka (status 404)'], ['/sama', 'Isi sama dengan halaman lain'],
    ]);

    const limited = await new CrawlWebsite({ reader }).execute({ url: s.url('/'), maxPages: 3 });
    assert.equal(limited.pages.length, 3);
    assert.equal((await new CrawlWebsite({ reader }).execute({ url: s.url('/'), maxPages: 999 })).limit, 20);

    // Batas waktu: setelah tenggat, halaman baru tidak dimulai dan hasil ditandai parsial.
    let clock = 0;
    const slowClock = new CrawlWebsite({ reader, concurrency: 1, deadlineMs: 100, now: () => { clock += 60; return clock; } });
    const partial = await slowClock.execute({ url: s.url('/') });
    assert.equal(partial.partial, true);
    assert.ok(partial.pages.length >= 1 && partial.pages.length < 6);

    // Halaman awal yang gagal membatalkan seluruhnya dengan pesan jelas.
    await rejects(new CrawlWebsite({ reader }).execute({ url: s.url('/tidak-ada') }), /status 404/);
  } finally { await s.close(); }
});

// ---------- HTTP ----------
async function startApp({ allowPrivateUrls }) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-web-'));
  const deps = await createDependencies({ DATA_DIR: dataDir });
  const app = await buildApp({
    ...deps, seedDir: path.join(root, 'knowledge'), publicDir: path.join(root, 'src/interface/web'),
    adminToken: 'token-otomasi-123', bootstrapAdmin: { username: 'admin', password: 'password-awal-1' },
    hasher: new ScryptPasswordHasher({ N: 1024 }), sessionSecret: 'rahasia-sesi-untuk-tes-web', allowPrivateUrls,
  });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://localhost:${app.server.address().port}`;
  const call = (method, url, body, auth = true) => fetch(base + url, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer token-otomasi-123' } : {}) },
  });
  const stop = async () => { await new Promise((r) => { app.server.closeAllConnections(); app.server.close(r); }); await rm(dataDir, { recursive: true, force: true }); };
  return { call, stop };
}

test('HTTP: bawaan memblokir alamat internal (termasuk server ini sendiri), butuh login, dan memvalidasi URL', async () => {
  const s = await site({ '/': { body: page('Internal', '<main><p>layanan internal yang tidak boleh terbaca dari luar</p></main>') } });
  const t = await startApp({ allowPrivateUrls: false });
  try {
    const blocked = await t.call('POST', '/api/admin/knowledge/import-url', { url: s.url('/') });
    assert.equal(blocked.status, 400);
    assert.match((await blocked.json()).error, /tidak diizinkan/);
    const self = await t.call('POST', '/api/admin/knowledge/import-url', { url: 'http://127.0.0.1:3100/api/admin/me', crawl: true });
    assert.equal(self.status, 400);
    assert.equal((await t.call('POST', '/api/admin/knowledge/import-url', { url: 'ftp://x.co/a' })).status, 400);
    assert.equal((await t.call('POST', '/api/admin/knowledge/import-url', {})).status, 400);
    assert.equal((await t.call('POST', '/api/admin/knowledge/import-url', { url: s.url('/') }, false)).status, 401);
  } finally { await t.stop(); await s.close(); }
});

test('HTTP: impor satu halaman dan jelajah situs (izin privat aktif), simpan hasilnya, lalu ditemukan pencarian', async () => {
  const s = await site({
    '/': { body: page('Beranda Lumicore', '<nav><a href="/garansi">Garansi</a><a href="/servis">Servis</a></nav><main><p>Lumicore menyediakan layanan kecerdasan buatan untuk perusahaan.</p></main>') },
    '/garansi': { body: page('Garansi Produk', '<main><h1>Garansi</h1><p>Semua perangkat mendapat garansi resmi selama dua puluh empat bulan sejak tanggal pembelian.</p></main>') },
    '/servis': { body: page('Pusat Servis', '<main><h1>Servis</h1><p>Pusat servis kami buka setiap hari kerja dan melayani perbaikan di tempat.</p></main>') },
  });
  const t = await startApp({ allowPrivateUrls: true });
  try {
    const one = await (await t.call('POST', '/api/admin/knowledge/import-url', { url: s.url('/garansi') })).json();
    assert.equal(one.title, 'Garansi Produk');
    assert.match(one.content, /garansi resmi selama dua puluh empat bulan/);

    const crawl = await (await t.call('POST', '/api/admin/knowledge/import-url', { url: s.url('/'), crawl: true, maxPages: 5 })).json();
    assert.deepEqual(crawl.pages.map((p) => p.title), ['Beranda Lumicore', 'Garansi Produk', 'Pusat Servis']);

    for (const p of crawl.pages) assert.equal((await t.call('POST', '/api/admin/knowledge', { title: p.title, content: p.content })).status, 201);
    const hits = await (await t.call('POST', '/api/admin/search', { query: 'garansi perangkat dua puluh empat bulan' })).json();
    assert.equal(hits.hits[0].title, 'Garansi Produk');
  } finally { await t.stop(); await s.close(); }
});
