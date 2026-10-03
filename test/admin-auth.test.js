import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValidPassword, createAdminUser, normalizeUsername } from '../src/domain/admin-user.js';
import { ValidationError } from '../src/domain/errors.js';
import { ScryptPasswordHasher } from '../src/infrastructure/security/scrypt-password-hasher.js';
import { HmacSessionTokens } from '../src/infrastructure/security/hmac-session-tokens.js';
import { InMemoryLoginThrottle } from '../src/infrastructure/security/in-memory-login-throttle.js';
import { JsonFileAdminUserRepository } from '../src/infrastructure/persistence/json-file-admin-user-repository.js';
import { buildApp } from '../src/composition.js';
import { createDependencies } from '../src/bootstrap.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fastHasher = new ScryptPasswordHasher({ N: 1024 }); // cepat untuk tes; format & logika sama

test('domain: aturan username dan password', () => {
  assert.equal(normalizeUsername('  Budi.S '), 'budi.s');
  const base = { id: '1', passwordHash: 'h', createdAt: 'x' };
  assert.equal(createAdminUser({ ...base, username: 'Budi' }).displayName, 'budi');
  assert.equal(createAdminUser({ ...base, username: 'budi', displayName: ' Budi Santoso ' }).displayName, 'Budi Santoso');
  for (const bad of ['ab', '-budi', 'bu di', 'x'.repeat(33), 'budi@mail', '']) {
    assert.throws(() => createAdminUser({ ...base, username: bad }), ValidationError, bad);
  }
  assert.doesNotThrow(() => assertValidPassword('abcd1234'));
  assert.throws(() => assertValidPassword('pendek'), /minimal 8/);
  assert.throws(() => assertValidPassword('x'.repeat(129)), /maksimal 128/);
  assert.throws(() => assertValidPassword('budi.santoso', { username: 'Budi.Santoso' }), /sama dengan username/);
  assert.throws(() => assertValidPassword(undefined), ValidationError);
});

test('hasher scrypt: verifikasi benar/salah, salt unik, format rusak ditolak', async () => {
  const hasher = new ScryptPasswordHasher({ N: 1024 });
  const a = await hasher.hash('rahasia123');
  const b = await hasher.hash('rahasia123');
  assert.match(a, /^scrypt\$1024\$8\$1\$/);
  assert.notEqual(a, b);
  assert.equal(await hasher.verify('rahasia123', a), true);
  assert.equal(await hasher.verify('rahasia124', a), false);
  assert.equal(await hasher.verify('rahasia123', 'bukan-hash'), false);
  assert.equal(await hasher.verify('rahasia123', 'scrypt$0$0$0$x$y'), false);
  assert.equal(await hasher.verify('rahasia123', 'scrypt$99999999$8$1$AAAA$AAAA'), false); // cost berlebihan ditolak
  // hash lama tetap bisa diverifikasi walau parameter bawaan berubah
  assert.equal(await new ScryptPasswordHasher({ N: 2048 }).verify('rahasia123', a), true);
});

test('token sesi: valid, kedaluwarsa, dimanipulasi, rahasia berbeda', () => {
  let now = 1_000_000_000_000;
  const tokens = new HmacSessionTokens({ secret: 'rahasia-sesi-untuk-tes', ttlSeconds: 60, now: () => now });
  const token = tokens.issue({ userId: 'u1', version: 3 });
  assert.deepEqual(tokens.verify(token), { userId: 'u1', version: 3 });
  assert.equal(new HmacSessionTokens({ secret: 'rahasia-lain-yang-berbeda!', now: () => now }).verify(token), null);

  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'admin-lain', v: 3, e: 9_999_999_999 })).toString('base64url');
  assert.equal(tokens.verify(`${forged}.${signature}`), null);
  assert.equal(tokens.verify(`${payload}.${signature}x`), null);
  assert.equal(tokens.verify(`${payload}.${signature}.extra`), null);
  for (const junk of ['', 'abc', null, undefined, 42, '.', 'a.b']) assert.equal(tokens.verify(junk), null);

  now += 61_000;
  assert.equal(tokens.verify(token), null);
  assert.throws(() => new HmacSessionTokens({ secret: 'pendek' }), /terlalu pendek/);
});

test('pembatas login: kunci setelah batas, reset, dan jendela kedaluwarsa', () => {
  let now = 0;
  const throttle = new InMemoryLoginThrottle({ now: () => now });
  const keys = ['u:budi', 'ip:1.2.3.4'];
  for (let i = 0; i < 4; i++) throttle.recordFailure(keys);
  assert.equal(throttle.retryAfter(keys), 0);
  throttle.recordFailure(keys);
  assert.equal(throttle.retryAfter(keys), 300);
  now += 100_000;
  assert.equal(throttle.retryAfter(keys), 200);
  assert.equal(throttle.retryAfter(['u:orang-lain', 'ip:9.9.9.9']), 0);
  now += 201_000;
  assert.equal(throttle.retryAfter(keys), 0);

  throttle.recordFailure(['u:ani']); throttle.reset(['u:ani']);
  for (let i = 0; i < 4; i++) throttle.recordFailure(['u:ani']);
  assert.equal(throttle.retryAfter(['u:ani']), 0); // hitungan sudah di-reset
});

test('repository file akun: simpan, unik username, tahan restart, izin file 600', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rag-users-'));
  try {
    const file = path.join(dir, 'u.json');
    const repo = new JsonFileAdminUserRepository(file);
    const mk = (id, username) => createAdminUser({ id, username, passwordHash: 'h', createdAt: `2026-01-0${id}` });
    await repo.save(mk('1', 'budi'));
    await repo.save(mk('2', 'ani'));
    await assert.rejects(repo.save(mk('3', 'budi')), /sudah dipakai/);
    await repo.save({ ...mk('1', 'budi'), displayName: 'Budi Baru' });
    const again = new JsonFileAdminUserRepository(file);
    assert.deepEqual((await again.list()).map((u) => u.username), ['budi', 'ani']);
    assert.equal((await again.getByUsername('budi')).displayName, 'Budi Baru');
    assert.equal(await again.delete('2'), true);
    assert.equal(await again.delete('2'), false);
    assert.equal((await readFile(file, 'utf8')).includes('Budi Baru'), true);
    assert.equal((await stat(file)).mode & 0o777, 0o600); // hash password tidak boleh terbaca pengguna lain
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---------- Integrasi HTTP ----------
const BOOT = { username: 'admin', password: 'password-awal-1' };

async function start({ trustProxy = false, bootstrapAdmin = BOOT, adminToken = 'token-otomasi-123', now } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-auth-'));
  const deps = await createDependencies({ DATA_DIR: dataDir });
  const app = await buildApp({
    ...deps, seedDir: path.join(root, 'knowledge'), publicDir: path.join(root, 'src/interface/web'),
    adminToken, bootstrapAdmin, trustProxy, hasher: fastHasher, sessionSecret: 'rahasia-sesi-untuk-tes-http',
  });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://localhost:${app.server.address().port}`;

  /** Klien kecil dengan "cookie jar" sendiri, meniru browser. */
  const client = (extraHeaders = {}) => {
    let cookie = '';
    const call = async (method, url, body, headers = {}) => {
      const res = await fetch(base + url, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...extraHeaders, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      const text = await res.text();
      return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null, text };
    };
    // defineProperty (bukan Object.assign) agar getter/setter tetap hidup dan terhubung ke cookie jar
    return Object.defineProperty(call, 'cookie', { get: () => cookie, set: (v) => { cookie = v; } });
  };
  const login = async (username = 'admin', password = BOOT.password, extra) => {
    const c = client(extra);
    const res = await c('POST', '/api/admin/login', { username, password });
    return { c, res };
  };
  const stop = async () => { await new Promise((r) => { app.server.closeAllConnections(); app.server.close(r); }); await rm(dataDir, { recursive: true, force: true }); };
  return { app, base, client, login, stop, dataDir };
}

test('login: pesan gagal sama untuk username/password salah, tanpa kebocoran hash', async () => {
  const t = await start();
  try {
    const wrongPw = await t.client()('POST', '/api/admin/login', { username: 'admin', password: 'salah-salah' });
    const wrongUser = await t.client()('POST', '/api/admin/login', { username: 'tidak-ada', password: 'salah-salah' });
    assert.equal(wrongPw.status, 401);
    assert.equal(wrongUser.status, 401);
    assert.deepEqual(wrongPw.json, wrongUser.json);
    assert.equal((await t.client()('POST', '/api/admin/login', {})).status, 401);
    assert.equal((await t.client()('POST', '/api/admin/login', { username: 'admin', password: 12345678 })).status, 401);

    const { c, res } = await t.login(' ADMIN ', BOOT.password); // username tidak peka huruf besar/kecil & spasi
    assert.equal(res.status, 200);
    assert.equal(res.json.user.username, 'admin');
    assert.ok(res.json.user.lastLoginAt);
    assert.doesNotMatch(res.text, /passwordHash|scrypt|tokenVersion/);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /^rag_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=43200/);
    assert.doesNotMatch(cookie, /Secure/); // HTTP biasa

    const me = await c('GET', '/api/admin/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.username, 'admin');
    assert.equal(me.headers.get('cache-control'), 'no-store');
    assert.equal((await t.client()('GET', '/api/admin/me')).status, 401);
  } finally { await t.stop(); }
});

test('cookie Secure hanya lewat proxy terpercaya yang menyatakan HTTPS', async () => {
  const trusted = await start({ trustProxy: true });
  const untrusted = await start({ trustProxy: false });
  try {
    const hdr = { 'x-forwarded-proto': 'https' };
    assert.match((await trusted.login('admin', BOOT.password, hdr)).res.headers.get('set-cookie'), /; Secure/);
    assert.doesNotMatch((await trusted.login('admin', BOOT.password)).res.headers.get('set-cookie'), /Secure/);
    assert.doesNotMatch((await untrusted.login('admin', BOOT.password, hdr)).res.headers.get('set-cookie'), /Secure/); // header palsu diabaikan
  } finally { await trusted.stop(); await untrusted.stop(); }
});

test('Bearer token otomasi tetap bisa mengelola knowledge, tetapi bukan akun', async () => {
  const t = await start();
  try {
    const bearer = { authorization: 'Bearer token-otomasi-123' };
    const c = t.client(bearer);
    assert.equal((await c('GET', '/api/admin/knowledge')).status, 200);
    assert.equal((await c('POST', '/api/admin/knowledge', { title: 'Via n8n', content: 'Dibuat otomasi.' })).status, 201);
    for (const [method, url, body] of [['GET', '/api/admin/me'], ['GET', '/api/admin/users'], ['POST', '/api/admin/password', { currentPassword: 'x', newPassword: 'yyyyyyyy' }]]) {
      assert.equal((await c(method, url, body)).status, 401, `${method} ${url}`);
    }
    assert.equal((await t.client({ authorization: 'Bearer salah' })('GET', '/api/admin/knowledge')).status, 401);
    assert.equal((await t.client()('GET', '/api/admin/knowledge')).status, 401);
  } finally { await t.stop(); }
});

test('tanpa ADMIN_TOKEN, API token dinonaktifkan sepenuhnya', async () => {
  const t = await start({ adminToken: undefined });
  try {
    assert.equal((await t.client({ authorization: 'Bearer ' })('GET', '/api/admin/knowledge')).status, 401);
    assert.equal((await t.client({ authorization: 'Bearer undefined' })('GET', '/api/admin/knowledge')).status, 401);
    const { c } = await t.login();
    assert.equal((await c('GET', '/api/admin/knowledge')).status, 200); // sesi login tetap berfungsi
  } finally { await t.stop(); }
});

test('pembatasan percobaan login: 5 gagal mengunci, password benar pun ditolak selama kunci', async () => {
  const t = await start();
  try {
    const c = t.client();
    for (let i = 0; i < 5; i++) assert.equal((await c('POST', '/api/admin/login', { username: 'admin', password: 'salah-salah' })).status, 401);
    const locked = await c('POST', '/api/admin/login', { username: 'admin', password: BOOT.password });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
    assert.match(locked.json.error, /Terlalu banyak/);
    // akun lain tidak terkena
    await (await t.login()).c('POST', '/api/admin/users', { username: 'ani', password: 'passwordani1' }).catch(() => {});
  } finally { await t.stop(); }
});

test('IP klien dari Cloudflare dipakai untuk pembatas hanya bila TRUST_PROXY aktif', async () => {
  const t = await start({ trustProxy: true });
  try {
    // 30 percobaan gagal dari IP yang sama dengan username berbeda-beda → IP dikunci
    const attacker = { 'cf-connecting-ip': '203.0.113.9' };
    for (let i = 0; i < 30; i++) await t.client(attacker)('POST', '/api/admin/login', { username: `u${i}x`, password: 'salah-salah' });
    assert.equal((await t.client(attacker)('POST', '/api/admin/login', { username: 'admin', password: BOOT.password })).status, 429);
    // IP lain (pengguna sah) tidak terdampak
    assert.equal((await t.client({ 'cf-connecting-ip': '198.51.100.7' })('POST', '/api/admin/login', { username: 'admin', password: BOOT.password })).status, 200);
  } finally { await t.stop(); }
});

test('ubah password: validasi, sesi lama dicabut, sesi ini tetap hidup', async () => {
  const t = await start();
  try {
    const { c } = await t.login();
    const oldCookie = c.cookie;
    assert.match(oldCookie, /^rag_session=.+/); // pastikan jar cookie benar-benar terisi
    const before = t.client(); before.cookie = oldCookie;
    assert.equal((await before('GET', '/api/admin/me')).status, 200); // kontrol: cookie lama valid sebelum password diubah
    assert.equal((await c('POST', '/api/admin/password', { currentPassword: 'salah-salah', newPassword: 'password-baru-2' })).status, 400);
    assert.equal((await c('POST', '/api/admin/password', { currentPassword: BOOT.password, newPassword: 'pendek' })).status, 400);
    assert.equal((await c('POST', '/api/admin/password', { currentPassword: BOOT.password, newPassword: BOOT.password })).status, 400);
    assert.equal((await c('POST', '/api/admin/password', { currentPassword: BOOT.password, newPassword: 'admin' })).status, 400);

    const ok = await c('POST', '/api/admin/password', { currentPassword: BOOT.password, newPassword: 'password-baru-2' });
    assert.equal(ok.status, 200);
    assert.notEqual(c.cookie, oldCookie);
    assert.equal((await c('GET', '/api/admin/me')).status, 200); // token baru dari respons

    const stale = t.client(); stale.cookie = oldCookie;
    assert.equal(stale.cookie, oldCookie);
    assert.equal((await stale('GET', '/api/admin/me')).status, 401); // sesi lama (mis. perangkat lain) dicabut

    assert.equal((await t.login('admin', BOOT.password)).res.status, 401);
    assert.equal((await t.login('admin', 'password-baru-2')).res.status, 200);
  } finally { await t.stop(); }
});

test('kelola akun: tambah, duplikat, validasi, login akun baru, hapus, reset password', async () => {
  const t = await start();
  try {
    const { c } = await t.login();
    assert.equal((await c('POST', '/api/admin/users', { username: 'ani', displayName: 'Ani Wijaya', password: 'passwordani1' })).status, 201);
    assert.equal((await c('POST', '/api/admin/users', { username: 'ANI', password: 'passwordani1' })).status, 409);
    assert.equal((await c('POST', '/api/admin/users', { username: 'x', password: 'passwordani1' })).status, 400);
    assert.equal((await c('POST', '/api/admin/users', { username: 'budi', password: 'pendek' })).status, 400);

    const list = (await c('GET', '/api/admin/users')).json.items;
    assert.deepEqual(list.map((u) => u.username), ['admin', 'ani']);
    assert.equal(list[1].displayName, 'Ani Wijaya');
    assert.doesNotMatch(JSON.stringify(list), /scrypt|passwordHash/);

    const ani = await t.login('ani', 'passwordani1');
    assert.equal(ani.res.status, 200);
    assert.equal((await ani.c('GET', '/api/admin/me')).json.user.displayName, 'Ani Wijaya');

    const aniId = list[1].id;
    const adminId = list[0].id;
    assert.equal((await c('POST', `/api/admin/users/${adminId}/password`, { newPassword: 'passwordbaru9' })).status, 400); // akun sendiri → pakai Ubah password
    assert.equal((await c('POST', `/api/admin/users/${aniId}/password`, { newPassword: 'ani' })).status, 400);
    assert.equal((await c('POST', `/api/admin/users/${aniId}/password`, { newPassword: 'passwordbaru9' })).status, 204);
    assert.equal((await ani.c('GET', '/api/admin/me')).status, 401); // sesi Ani dicabut saat direset
    assert.equal((await t.login('ani', 'passwordani1')).res.status, 401);
    assert.equal((await t.login('ani', 'passwordbaru9')).res.status, 200);
    assert.equal((await c('POST', '/api/admin/users/tidak-ada/password', { newPassword: 'passwordbaru9' })).status, 404);

    assert.equal((await c('DELETE', `/api/admin/users/${adminId}`)).status, 400); // tidak bisa menghapus diri sendiri
    assert.equal((await c('DELETE', '/api/admin/users/tidak-ada')).status, 404);
    const aniSession = (await t.login('ani', 'passwordbaru9')).c;
    assert.equal((await c('DELETE', `/api/admin/users/${aniId}`)).status, 204);
    assert.equal((await aniSession('GET', '/api/admin/me')).status, 401); // akun dihapus → sesinya mati
    assert.equal((await t.login('ani', 'passwordbaru9')).res.status, 401);
  } finally { await t.stop(); }
});

test('akun admin terakhir tidak bisa dihapus', async () => {
  const t = await start();
  try {
    const { c } = await t.login();
    await c('POST', '/api/admin/users', { username: 'ani', password: 'passwordani1' });
    const ani = (await t.login('ani', 'passwordani1')).c;
    const users = (await ani('GET', '/api/admin/users')).json.items;
    assert.equal((await ani('DELETE', `/api/admin/users/${users[0].id}`)).status, 204); // ani menghapus admin → tersisa 1
    const rest = (await ani('GET', '/api/admin/users')).json.items;
    assert.equal(rest.length, 1);
    // satu-satunya akun tersisa tidak bisa dihapus: oleh diri sendiri ditolak (400)
    assert.equal((await ani('DELETE', `/api/admin/users/${rest[0].id}`)).status, 400);
  } finally { await t.stop(); }
});

test('CSRF: permintaan tulis lintas-situs ditolak, same-origin dan klien non-browser diterima', async () => {
  const t = await start({ trustProxy: true });
  try {
    const { c } = await t.login();
    const doc = { title: 'Uji CSRF', content: 'isi dokumen uji' };
    const host = new URL(t.base).host;
    assert.equal((await c('POST', '/api/admin/knowledge', doc, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await c('POST', '/api/admin/knowledge', doc, { 'sec-fetch-site': 'same-site' })).status, 403); // subdomain lain
    assert.equal((await c('POST', '/api/admin/knowledge', doc, { origin: 'https://jahat.example' })).status, 403);
    assert.equal((await c('POST', '/api/admin/knowledge', doc, { origin: 'not a url' })).status, 403);
    assert.equal((await t.client()('POST', '/api/admin/login', BOOT, { 'sec-fetch-site': 'cross-site' })).status, 403); // login CSRF
    assert.equal((await c('GET', '/api/admin/knowledge', undefined, { 'sec-fetch-site': 'cross-site' })).status, 200); // baca tidak mengubah data

    assert.equal((await c('POST', '/api/admin/knowledge', doc, { 'sec-fetch-site': 'same-origin' })).status, 201);
    assert.equal((await c('POST', '/api/admin/knowledge', { ...doc, title: 'Uji 2' }, { origin: `http://${host}` })).status, 201);
    assert.equal((await c('POST', '/api/admin/knowledge', { ...doc, title: 'Uji 3' }, { origin: 'https://rag.contoh.id', 'x-forwarded-host': 'rag.contoh.id' })).status, 201);
    assert.equal((await c('POST', '/api/admin/knowledge', { ...doc, title: 'Uji 4' })).status, 201); // curl/n8n: tanpa header browser
  } finally { await t.stop(); }
});

test('logout menghapus cookie; akun pertama dibuat sekali dan password acak bila tidak diset', async () => {
  const t = await start();
  try {
    const { c } = await t.login();
    const out = await c('POST', '/api/admin/logout', {});
    assert.equal(out.status, 204);
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal(c.cookie, '');
    assert.equal((await c('GET', '/api/admin/me')).status, 401);
    assert.equal(t.app.seededAdmin.created, true);

    // start ulang dengan data yang sama: tidak membuat akun lagi, password lama tetap berlaku
    await new Promise((r) => { t.app.server.closeAllConnections(); t.app.server.close(r); });
    const deps = await createDependencies({ DATA_DIR: t.dataDir });
    const again = await buildApp({ ...deps, seedDir: path.join(root, 'knowledge'), publicDir: '.', bootstrapAdmin: { username: 'lain', password: 'diabaikan-saja' }, hasher: fastHasher });
    assert.equal(again.seededAdmin.created, false);
    assert.equal((await deps.adminUsers.list()).length, 1);
  } finally { await t.stop(); }

  const generated = await start({ bootstrapAdmin: { username: 'owner', password: undefined } });
  try {
    const { username, generatedPassword } = generated.app.seededAdmin;
    assert.equal(username, 'owner');
    assert.ok(generatedPassword.length >= 12);
    assert.equal((await generated.login('owner', generatedPassword)).res.status, 200);
  } finally { await generated.stop(); }
});

test('halaman admin dilayani dan tidak menyimpan kredensial di penyimpanan browser', async () => {
  const t = await start();
  try {
    const js = await (await fetch(t.base + '/admin.js')).text();
    assert.doesNotMatch(js, /sessionStorage|localStorage/);
    assert.doesNotMatch(js, /Authorization|Bearer/);
  } finally { await t.stop(); }
});

// ---------- Pendaftaran & persetujuan ----------
const NEW = { username: 'sari', displayName: 'Sari', password: 'password-sari-1' };

test('pendaftaran: akun menunggu, tidak bisa login, setelah disetujui punya hak admin penuh', async () => {
  const t = await start();
  try {
    const anon = t.client();
    const reg = await anon('POST', '/api/admin/register', NEW);
    assert.equal(reg.status, 202);
    assert.equal(reg.json.status, 'pending');
    assert.equal(reg.headers.get('set-cookie'), null); // mendaftar tidak membuat sesi
    assert.doesNotMatch(reg.text, /passwordHash|scrypt/);

    // Username kembar, password lemah, dan username tak valid ditolak dengan jelas.
    assert.equal((await t.client()('POST', '/api/admin/register', NEW)).status, 409);
    assert.equal((await t.client()('POST', '/api/admin/register', { ...NEW, username: 'budi', password: 'pendek' })).status, 400);
    assert.equal((await t.client()('POST', '/api/admin/register', { ...NEW, username: 'bu di' })).status, 400);

    // Password benar tetapi belum disetujui → 403 dengan pesan jelas; password salah tetap 401 biasa.
    const pending = await t.client()('POST', '/api/admin/login', { username: 'sari', password: NEW.password });
    assert.equal(pending.status, 403);
    assert.match(pending.json.error, /menunggu persetujuan/);
    assert.equal(pending.headers.get('set-cookie'), null);
    assert.equal((await t.client()('POST', '/api/admin/login', { username: 'sari', password: 'salah-salah' })).status, 401);

    // Admin melihat antrean, lalu menyetujui.
    const { c: admin } = await t.login();
    const list = (await admin('GET', '/api/admin/users')).json.items;
    const sari = list.find((u) => u.username === 'sari');
    assert.equal(sari.status, 'pending');
    assert.equal(list.find((u) => u.username === 'admin').status, 'active');
    assert.equal((await admin('POST', `/api/admin/users/${sari.id}/approve`)).json.status, 'active');
    assert.equal((await admin('POST', '/api/admin/users/tidak-ada/approve')).status, 404);

    // Sekarang sari bisa login dan mengelola KNOWLEDGE YANG SAMA dengan admin.
    const { c: sariClient, res } = await t.login('sari', NEW.password);
    assert.equal(res.status, 200);
    const created = await sariClient('POST', '/api/admin/knowledge', { title: 'Dari Sari', content: 'Isi dari akun sari.' });
    assert.equal(created.status, 201);
    const seenByAdmin = (await admin('GET', '/api/admin/knowledge')).json.items.map((d) => d.title);
    assert.ok(seenByAdmin.includes('Dari Sari'));
    assert.equal((await sariClient('GET', '/api/admin/users')).status, 200); // hak admin: bisa kelola akun
  } finally { await t.stop(); }
});

test('pendaftaran: akun menunggu tidak punya sesi, bisa ditolak (hapus), dan tidak dihitung sebagai admin terakhir', async () => {
  const t = await start();
  try {
    await t.client()('POST', '/api/admin/register', NEW);
    const { c: admin } = await t.login();
    const users = (await admin('GET', '/api/admin/users')).json.items;
    const sari = users.find((u) => u.username === 'sari');
    const me = users.find((u) => u.username === 'admin');

    assert.equal((await admin('DELETE', `/api/admin/users/${sari.id}`)).status, 204); // tolak pendaftaran
    assert.equal((await admin('DELETE', `/api/admin/users/${me.id}`)).status, 400);    // diri sendiri / admin aktif terakhir

    // Admin aktif terakhir tidak bisa dihapus walau ada akun menunggu.
    await t.client()('POST', '/api/admin/register', NEW);
    const waiting = (await admin('GET', '/api/admin/users')).json.items.find((u) => u.username === 'sari');
    const { c: other } = await t.login(); // sesi kedua milik admin yang sama
    assert.equal((await other('DELETE', `/api/admin/users/${me.id}`)).status, 400);
    assert.equal((await admin('GET', '/api/admin/users')).json.items.some((u) => u.id === waiting.id), true);
  } finally { await t.stop(); }
});

test('pendaftaran: dibatasi per alamat IP dan memerlukan permintaan satu-situs', async () => {
  const t = await start();
  try {
    const anon = t.client();
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await anon('POST', '/api/admin/register', { username: `user${i}`, password: 'password-bagus-1' })).status, 202);
    }
    const blocked = await anon('POST', '/api/admin/register', { username: 'user9', password: 'password-bagus-1' });
    assert.equal(blocked.status, 429);
    assert.match(blocked.json.error, /pendaftaran/i);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);

    const cross = await t.client()('POST', '/api/admin/register', { username: 'lain', password: 'password-bagus-1' }, { 'sec-fetch-site': 'cross-site' });
    assert.equal(cross.status, 403);
  } finally { await t.stop(); }
});

test('seed admin: akun menunggu tidak dianggap admin; migrasi PostgreSQL memberi status aktif pada akun lama', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rag-seed-'));
  try {
    const repo = new JsonFileAdminUserRepository(path.join(dir, 'u.json'));
    await repo.save(createAdminUser({ id: '1', username: 'sari', passwordHash: 'h', createdAt: '2026-01-01', status: 'pending' }));
    const { SeedAdminUser } = await import('../src/application/use-cases/admin-auth.js');
    const seeded = await new SeedAdminUser({ users: repo, hasher: fastHasher, newId: () => '2', now: () => new Date() }).execute({ password: 'password-awal-1' });
    assert.equal(seeded.created, true);
    assert.equal((await repo.getByUsername('admin')).status, 'active');
    assert.equal(createAdminUser({ id: '3', username: 'lama', passwordHash: 'h', createdAt: 'x' }).status, 'active'); // data lama tanpa status
    assert.throws(() => createAdminUser({ id: '3', username: 'lama', passwordHash: 'h', createdAt: 'x', status: 'aneh' }), ValidationError);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('berkas statis tidak boleh di-cache (mencegah Cloudflare menyajikan JS lama dengan HTML baru)', async () => {
  const t = await start();
  try {
    for (const file of ['/', '/admin.html', '/admin.js', '/app.js', '/styles.css', '/logo.png']) {
      const res = await fetch(t.base + file);
      assert.equal(res.status, 200, file);
      assert.equal(res.headers.get('cache-control'), 'no-store', file);
    }
    assert.equal((await fetch(t.base + '/logo.png')).headers.get('content-type'), 'image/png');
  } finally { await t.stop(); }
});

test('edit profil: ubah nama tampilan dan username sendiri maupun akun lain, dengan validasi dan tanpa mencabut sesi', async () => {
  const t = await start();
  try {
    const { c: admin } = await t.login();
    const created = await admin('POST', '/api/admin/users', { username: 'budi', displayName: 'Budi', password: 'password-budi-1' });
    const budiId = created.json.id;
    const adminId = (await admin('GET', '/api/admin/me')).json.user.id;

    // Akun sendiri: nama tampilan + username; sesi tetap berlaku karena token mengacu ke id.
    const own = await admin('PATCH', `/api/admin/users/${adminId}`, { displayName: ' Indriana ', username: 'Indriana.A' });
    assert.equal(own.status, 200);
    assert.equal(own.json.user.displayName, 'Indriana');
    assert.equal(own.json.user.username, 'indriana.a');
    assert.doesNotMatch(own.text, /passwordHash|scrypt|tokenVersion/);
    assert.equal((await admin('GET', '/api/admin/me')).json.user.username, 'indriana.a');
    assert.equal((await t.login('indriana.a', BOOT.password)).res.status, 200);
    assert.equal((await t.client()('POST', '/api/admin/login', { username: 'admin', password: BOOT.password })).status, 401); // username lama tidak berlaku

    // Akun lain.
    const other = await admin('PATCH', `/api/admin/users/${budiId}`, { displayName: 'Budi Santoso' });
    assert.equal(other.json.user.displayName, 'Budi Santoso');
    assert.equal(other.json.user.username, 'budi'); // field yang tidak dikirim tidak berubah

    // Mengosongkan nama tampilan → kembali ke username. Hanya satu field boleh dikirim.
    assert.equal((await admin('PATCH', `/api/admin/users/${budiId}`, { displayName: '  ' })).json.user.displayName, 'budi');

    // Validasi.
    assert.equal((await admin('PATCH', `/api/admin/users/${budiId}`, { username: 'indriana.a' })).status, 409);
    assert.equal((await admin('PATCH', `/api/admin/users/${budiId}`, { username: 'bu di' })).status, 400);
    assert.equal((await admin('PATCH', `/api/admin/users/${budiId}`, { displayName: 'x'.repeat(61) })).status, 400);
    assert.equal((await admin('PATCH', `/api/admin/users/${budiId}`, {})).status, 400);
    assert.equal((await admin('PATCH', '/api/admin/users/tidak-ada', { displayName: 'X' })).status, 404);
    assert.equal((await admin('PATCH', `/api/admin/users/${budiId}`, { username: 'budi' })).status, 200); // tanpa perubahan = tidak error

    // Wajib sesi login; Bearer token otomasi dan anonim ditolak; lintas-situs ditolak.
    assert.equal((await t.client()('PATCH', `/api/admin/users/${budiId}`, { displayName: 'X' })).status, 401);
    assert.equal((await t.client()('PATCH', `/api/admin/users/${budiId}`, { displayName: 'X' }, { authorization: 'Bearer token-otomasi-123' })).status, 401);
    assert.equal((await admin('PATCH', `/api/admin/users/${budiId}`, { displayName: 'X' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  } finally { await t.stop(); }
});

test('aset diberi versi otomatis (?v=hash) di HTML dan import antar-modul, sehingga cache lama tidak terpakai', async () => {
  const t = await start();
  try {
    const html = await (await fetch(`${t.base}/`)).text();
    const version = html.match(/\/app\.js\?v=([0-9a-f]{12})"/)?.[1];
    assert.ok(version, 'script app.js harus berversi');
    assert.match(html, new RegExp(`/styles\\.css\\?v=${version}"`));
    assert.match(html, new RegExp(`/logo\\.png\\?v=${version}"`));
    assert.doesNotMatch(html, /(src|href)="\/[\w.-]+\.(js|css|png)"/); // tidak ada yang tanpa versi

    // Import antar-modul memakai versi yang sama → satu instance modul (bahasa terpilih dibagi app.js dan api.js).
    const app = await (await fetch(`${t.base}/app.js?v=${version}`)).text();
    assert.match(app, new RegExp(`from './i18n\\.js\\?v=${version}'`));
    const api = await (await fetch(`${t.base}/api.js`)).text();
    assert.match(api, new RegExp(`from './i18n\\.js\\?v=${version}'`));
    const admin = await (await fetch(`${t.base}/admin.html`)).text();
    assert.match(admin, new RegExp(`/admin\\.js\\?v=${version}"`));

    // Query string tidak mengganggu pelayanan berkas, dan tipe isi tetap benar.
    const res = await fetch(`${t.base}/i18n.js?v=sembarang`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-store');

    // Gambar tidak diubah isinya.
    const logo = Buffer.from(await (await fetch(`${t.base}/logo.png`)).arrayBuffer());
    assert.equal(logo.subarray(1, 4).toString(), 'PNG');
  } finally { await t.stop(); }
});
