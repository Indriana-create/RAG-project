import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  AuthenticationError, ConflictError, ForbiddenError, NotFoundError, TooManyAttemptsError, UpstreamError, ValidationError,
} from '../../application/errors.js';
import {
  SESSION_COOKIE, clearedSessionCookie, clientIp, isCrossSiteWrite, isSecureRequest, parseCookies, sessionCookie,
} from './request-context.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const MAX_BODY = 1_000_000;
const MAX_KNOWLEDGE_BODY = 3_000_000; // isi knowledge sampai 500.000 karakter (bisa 2 byte/karakter) + JSON
const MAX_UPLOAD = 10 * 1024 * 1024;

/**
 * Path ':nama' menjadi named group regex. `auth`:
 *  - 'none'    publik
 *  - 'admin'   sesi login ATAU Bearer token (otomasi)
 *  - 'session' hanya sesi login (akun, ubah password) — Bearer tidak cukup
 * `maxBody` membatasi ukuran JSON; `raw` menerima isi mentah (unggah file) dan mengirimnya sebagai Buffer.
 */
const route = (method, pattern, handler, { auth = 'none', maxBody = MAX_BODY, raw = false } = {}) => ({
  method, handler, auth, maxBody, raw,
  regex: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[\\w-]+)')}$`),
});

export function createServer({
  chat, adminKnowledge, adminAccounts, adminAssistant, authenticateBearer, resolveSession, sessionTtlSeconds = 12 * 3600,
  trustProxy = false, cookieSecure = 'auto', publicDir,
}) {
  const routes = [
    route('GET', '/api/health', async () => ({ status: 200, body: { ok: true } })),
    route('POST', '/api/chat', chat.chat),
    route('POST', '/api/chat/stream', chat.chatStream),
    route('GET', '/api/suggestions', chat.suggestions),
    route('GET', '/api/history/:sessionId', chat.history),
    route('DELETE', '/api/history/:sessionId', chat.clear),

    route('POST', '/api/admin/login', adminAccounts.login),
    route('POST', '/api/admin/register', adminAccounts.register),
    route('POST', '/api/admin/logout', adminAccounts.logout),
    route('GET', '/api/admin/me', adminAccounts.me, { auth: 'session' }),
    route('POST', '/api/admin/password', adminAccounts.changePassword, { auth: 'session' }),
    route('GET', '/api/admin/users', adminAccounts.users, { auth: 'session' }),
    route('POST', '/api/admin/users', adminAccounts.createUser, { auth: 'session' }),
    route('PATCH', '/api/admin/users/:id', adminAccounts.updateUser, { auth: 'session' }),
    route('DELETE', '/api/admin/users/:id', adminAccounts.removeUser, { auth: 'session' }),
    route('POST', '/api/admin/users/:id/approve', adminAccounts.approveUser, { auth: 'session' }),
    route('POST', '/api/admin/users/:id/password', adminAccounts.resetPassword, { auth: 'session' }),

    route('GET', '/api/admin/assistant', adminAssistant.get, { auth: 'session' }),
    route('PUT', '/api/admin/assistant', adminAssistant.update, { auth: 'session' }),
    route('POST', '/api/admin/assistant/suggest', adminAssistant.suggest, { auth: 'session' }),

    route('POST', '/api/admin/search', adminKnowledge.search, { auth: 'admin' }),
    route('GET', '/api/admin/knowledge', adminKnowledge.list, { auth: 'admin' }),
    route('POST', '/api/admin/knowledge/extract', adminKnowledge.extract, { auth: 'admin', raw: true }),
    route('POST', '/api/admin/knowledge/import-url', adminKnowledge.importUrl, { auth: 'admin' }),
    route('POST', '/api/admin/knowledge', adminKnowledge.create, { auth: 'admin', maxBody: MAX_KNOWLEDGE_BODY }),
    route('GET', '/api/admin/knowledge/:id', adminKnowledge.get, { auth: 'admin' }),
    route('PUT', '/api/admin/knowledge/:id', adminKnowledge.update, { auth: 'admin', maxBody: MAX_KNOWLEDGE_BODY }),
    route('PATCH', '/api/admin/knowledge/:id', adminKnowledge.update, { auth: 'admin', maxBody: MAX_KNOWLEDGE_BODY }),
    route('DELETE', '/api/admin/knowledge/:id', adminKnowledge.remove, { auth: 'admin' }),
  ];

  /** Siapa pemanggilnya: akun dari cookie sesi, token API, atau tidak ada. */
  async function authenticate(req) {
    const user = await resolveSession.execute(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (user) return { type: 'session', user };
    if (authenticateBearer(req)) return { type: 'token' };
    return null;
  }

  const assets = createAssetVersion(publicDir);

  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (!pathname.startsWith('/api/')) return await serveStatic(res, publicDir, pathname, assets);

      for (const { method, regex, handler, auth, maxBody, raw } of routes) {
        const match = regex.exec(pathname);
        if (!match || req.method !== method) continue;

        const isAdminApi = pathname.startsWith('/api/admin/');
        if (isAdminApi && isCrossSiteWrite(req, { trustProxy })) return send(res, 403, { error: 'Permintaan lintas-situs ditolak' });
        const actor = auth === 'none' ? null : await authenticate(req);
        if (auth === 'admin' && !actor) return send(res, 401, { error: 'Belum login atau token tidak valid' });
        if (auth === 'session' && actor?.type !== 'session') return send(res, 401, { error: 'Belum login' });

        const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
        const body = !hasBody ? undefined : raw ? await readRaw(req, MAX_UPLOAD) : await readJson(req, maxBody);
        const abort = new AbortController();
        res.on('close', () => abort.abort()); // klien memutus koneksi → hentikan LLM
        const out = await handler({ body, params: { ...match.groups }, signal: abort.signal, actor, ip: clientIp(req, { trustProxy }), headers: req.headers });
        if (out.stream) return await sendEvents(res, out.stream, abort.signal);

        const headers = {};
        const secure = isSecureRequest(req, { trustProxy, cookieSecure });
        if (out.session === 'clear') headers['set-cookie'] = clearedSessionCookie({ secure });
        else if (out.session) headers['set-cookie'] = sessionCookie(out.session.token, { secure, maxAgeSeconds: sessionTtlSeconds });
        return send(res, out.status, out.body, headers);
      }
      return send(res, 404, { error: 'Tidak ditemukan' });
    } catch (err) {
      const { status, message, headers } = toHttpError(err);
      return send(res, status, { error: message }, headers);
    }
  });
}

/** Memetakan error ke respons; detail internal hanya masuk log, tidak ke klien. */
function toHttpError(err) {
  if (err instanceof ValidationError) return { status: 400, message: err.message };
  if (err instanceof NotFoundError) return { status: 404, message: err.message };
  if (err instanceof AuthenticationError) return { status: 401, message: err.message };
  if (err instanceof ForbiddenError) return { status: 403, message: err.message };
  if (err instanceof ConflictError) return { status: 409, message: err.message };
  if (err instanceof TooManyAttemptsError) return { status: 429, message: err.message, headers: { 'retry-after': String(err.retryAfterSeconds) } };
  if (err.name === 'AbortError') return { status: 499, message: 'Permintaan dibatalkan' };
  console.error(err);
  if (err instanceof UpstreamError) return { status: 502, message: 'Layanan model bahasa sedang tidak tersedia. Coba lagi sebentar.' };
  return { status: 500, message: 'Terjadi kesalahan pada server' };
}

/**
 * Mengalirkan event ke klien (SSE). Event pertama ditunggu sebelum header dikirim,
 * sehingga error validasi tetap menjadi respons JSON biasa (400), bukan stream.
 */
async function sendEvents(res, events, signal) {
  const iterator = events[Symbol.asyncIterator]();
  let step = await iterator.next();
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  });
  try {
    while (!step.done) {
      res.write(`data: ${JSON.stringify(step.value)}\n\n`);
      step = await iterator.next();
    }
  } catch (err) {
    if (!signal.aborted) res.write(`data: ${JSON.stringify({ type: 'error', message: toHttpError(err).message })}\n\n`);
  } finally {
    await iterator.return?.();
    res.end();
  }
}

/**
 * Versi aset = hash isi semua berkas web. Dipakai sebagai `?v=...` pada URL JS/CSS/gambar (di HTML dan di import antar-modul)
 * agar peramban/CDN yang masih menyimpan salinan lama (mis. dari sebelum `no-store`) otomatis meminta berkas baru
 * setiap kali aplikasi diperbarui. Dihitung sekali (lazy) per proses.
 */
function createAssetVersion(root) {
  let pending;
  return () => (pending ??= (async () => {
    const hash = createHash('sha256');
    const files = (await readdir(root, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name).sort();
    for (const name of files) hash.update(name).update(await readFile(path.join(root, name)));
    return hash.digest('hex').slice(0, 12);
  })().catch((err) => { pending = undefined; throw err; })); // gagal sekali tidak boleh macet selamanya
}

const ASSET_URL = /\b(src|href)="(\/[\w.-]+\.(?:js|css|png|jpg|webp|ico))"/g;
const MODULE_IMPORT = /(\bfrom\s+|\bimport\()'(\.\/[\w.-]+\.js)'/g;

function withVersion(ext, data, version) {
  if (ext === '.html') return data.toString('utf8').replace(ASSET_URL, `$1="$2?v=${version}"`);
  if (ext === '.js') return data.toString('utf8').replace(MODULE_IMPORT, `$1'$2?v=${version}'`);
  return data;
}

async function serveStatic(res, root, pathname, assetVersion) {
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(root + path.sep)) return send(res, 403, { error: 'Dilarang' });
  try {
    const ext = path.extname(file);
    const data = withVersion(ext, await readFile(file), await assetVersion());
    // no-store: Cloudflare/peramban tidak boleh menyajikan halaman versi lama setelah aplikasi diperbarui
    // (HTML baru dengan JS lama membuat form tampak "tidak menyimpan").
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    }).end(data);
  } catch {
    send(res, 404, { error: 'Tidak ditemukan' });
  }
}

/** Membaca isi permintaan sebagai Buffer, berhenti begitu melewati batas (tanpa menampung sisanya). */
async function readBuffer(req, maxBytes, tooBig) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new ValidationError(tooBig);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new ValidationError(tooBig);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const readRaw = (req, maxBytes) => readBuffer(req, maxBytes, `File terlalu besar (maksimal ${Math.round(maxBytes / 1024 / 1024)} MB)`);

async function readJson(req, maxBytes = MAX_BODY) {
  // Dikumpulkan sebagai Buffer lalu didekode sekali: mendekode per potongan merusak karakter multi-byte di perbatasan potongan.
  const raw = (await readBuffer(req, maxBytes, 'Payload terlalu besar')).toString('utf8');
  let parsed;
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { throw new ValidationError('JSON tidak valid'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ValidationError('Body harus berupa objek JSON');
  return parsed;
}

function send(res, status, body, headers = {}) {
  if (body === undefined) return res.writeHead(status, { 'cache-control': 'no-store', ...headers }).end();
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body));
}
