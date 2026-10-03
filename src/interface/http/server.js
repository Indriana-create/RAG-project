import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AuthenticationError, ConflictError, ForbiddenError, NotFoundError, TooManyAttemptsError, UpstreamError, ValidationError,
} from '../../application/errors.js';
import {
  SESSION_COOKIE, clearedSessionCookie, clientIp, isCrossSiteWrite, isSecureRequest, parseCookies, sessionCookie,
} from './request-context.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const MAX_BODY = 1_000_000;

/**
 * Path ':nama' menjadi named group regex. `auth`:
 *  - 'none'    publik
 *  - 'admin'   sesi login ATAU Bearer token (otomasi)
 *  - 'session' hanya sesi login (akun, ubah password) — Bearer tidak cukup
 */
const route = (method, pattern, handler, { auth = 'none' } = {}) => ({
  method, handler, auth,
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
    route('GET', '/api/history/:sessionId', chat.history),
    route('DELETE', '/api/history/:sessionId', chat.clear),

    route('POST', '/api/admin/login', adminAccounts.login),
    route('POST', '/api/admin/register', adminAccounts.register),
    route('POST', '/api/admin/logout', adminAccounts.logout),
    route('GET', '/api/admin/me', adminAccounts.me, { auth: 'session' }),
    route('POST', '/api/admin/password', adminAccounts.changePassword, { auth: 'session' }),
    route('GET', '/api/admin/users', adminAccounts.users, { auth: 'session' }),
    route('POST', '/api/admin/users', adminAccounts.createUser, { auth: 'session' }),
    route('DELETE', '/api/admin/users/:id', adminAccounts.removeUser, { auth: 'session' }),
    route('POST', '/api/admin/users/:id/approve', adminAccounts.approveUser, { auth: 'session' }),
    route('POST', '/api/admin/users/:id/password', adminAccounts.resetPassword, { auth: 'session' }),

    route('GET', '/api/admin/assistant', adminAssistant.get, { auth: 'session' }),
    route('PUT', '/api/admin/assistant', adminAssistant.update, { auth: 'session' }),

    route('POST', '/api/admin/search', adminKnowledge.search, { auth: 'admin' }),
    route('GET', '/api/admin/knowledge', adminKnowledge.list, { auth: 'admin' }),
    route('POST', '/api/admin/knowledge', adminKnowledge.create, { auth: 'admin' }),
    route('GET', '/api/admin/knowledge/:id', adminKnowledge.get, { auth: 'admin' }),
    route('PUT', '/api/admin/knowledge/:id', adminKnowledge.update, { auth: 'admin' }),
    route('PATCH', '/api/admin/knowledge/:id', adminKnowledge.update, { auth: 'admin' }),
    route('DELETE', '/api/admin/knowledge/:id', adminKnowledge.remove, { auth: 'admin' }),
  ];

  /** Siapa pemanggilnya: akun dari cookie sesi, token API, atau tidak ada. */
  async function authenticate(req) {
    const user = await resolveSession.execute(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (user) return { type: 'session', user };
    if (authenticateBearer(req)) return { type: 'token' };
    return null;
  }

  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (!pathname.startsWith('/api/')) return await serveStatic(res, publicDir, pathname);

      for (const { method, regex, handler, auth } of routes) {
        const match = regex.exec(pathname);
        if (!match || req.method !== method) continue;

        const isAdminApi = pathname.startsWith('/api/admin/');
        if (isAdminApi && isCrossSiteWrite(req, { trustProxy })) return send(res, 403, { error: 'Permintaan lintas-situs ditolak' });
        const actor = auth === 'none' ? null : await authenticate(req);
        if (auth === 'admin' && !actor) return send(res, 401, { error: 'Belum login atau token tidak valid' });
        if (auth === 'session' && actor?.type !== 'session') return send(res, 401, { error: 'Belum login' });

        const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readJson(req) : undefined;
        const abort = new AbortController();
        res.on('close', () => abort.abort()); // klien memutus koneksi → hentikan LLM
        const out = await handler({ body, params: { ...match.groups }, signal: abort.signal, actor, ip: clientIp(req, { trustProxy }) });
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

async function serveStatic(res, root, pathname) {
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(root + path.sep)) return send(res, 403, { error: 'Dilarang' });
  try {
    const data = await readFile(file);
    // no-store: Cloudflare/peramban tidak boleh menyajikan halaman versi lama setelah aplikasi diperbarui
    // (HTML baru dengan JS lama membuat form tampak "tidak menyimpan").
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    }).end(data);
  } catch {
    send(res, 404, { error: 'Tidak ditemukan' });
  }
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new ValidationError('Payload terlalu besar');
  }
  let parsed;
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { throw new ValidationError('JSON tidak valid'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ValidationError('Body harus berupa objek JSON');
  return parsed;
}

function send(res, status, body, headers = {}) {
  if (body === undefined) return res.writeHead(status, { 'cache-control': 'no-store', ...headers }).end();
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body));
}
