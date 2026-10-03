import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NotFoundError, UpstreamError, ValidationError } from '../../application/errors.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const MAX_BODY = 1_000_000;

/** Path ':nama' menjadi named group regex. */
const route = (method, pattern, handler, { admin = false } = {}) => ({
  method, handler, admin,
  regex: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[\\w-]+)')}$`),
});

export function createServer({ chat, adminKnowledge, authenticateAdmin, publicDir }) {
  const routes = [
    route('GET', '/api/health', async () => ({ status: 200, body: { ok: true } })),
    route('POST', '/api/chat', chat.chat),
    route('POST', '/api/chat/stream', chat.chatStream),
    route('GET', '/api/history/:sessionId', chat.history),
    route('DELETE', '/api/history/:sessionId', chat.clear),
    route('POST', '/api/admin/search', adminKnowledge.search, { admin: true }),
    route('GET', '/api/admin/knowledge', adminKnowledge.list, { admin: true }),
    route('POST', '/api/admin/knowledge', adminKnowledge.create, { admin: true }),
    route('GET', '/api/admin/knowledge/:id', adminKnowledge.get, { admin: true }),
    route('PUT', '/api/admin/knowledge/:id', adminKnowledge.update, { admin: true }),
    route('PATCH', '/api/admin/knowledge/:id', adminKnowledge.update, { admin: true }),
    route('DELETE', '/api/admin/knowledge/:id', adminKnowledge.remove, { admin: true }),
  ];

  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (!pathname.startsWith('/api/')) return await serveStatic(res, publicDir, pathname);

      for (const { method, regex, handler, admin } of routes) {
        const match = regex.exec(pathname);
        if (!match || req.method !== method) continue;
        if (admin && !authenticateAdmin(req)) return send(res, 401, { error: 'Tidak diizinkan: token admin salah atau tidak ada' });
        const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readJson(req) : undefined;
        const abort = new AbortController();
        res.on('close', () => abort.abort()); // klien memutus koneksi → hentikan LLM
        const out = await handler({ body, params: { ...match.groups }, signal: abort.signal });
        if (out.stream) return await sendEvents(res, out.stream, abort.signal);
        return send(res, out.status, out.body);
      }
      return send(res, 404, { error: 'Tidak ditemukan' });
    } catch (err) {
      const { status, message } = toHttpError(err);
      return send(res, status, { error: message });
    }
  });
}

/** Memetakan error ke respons; detail internal hanya masuk log, tidak ke klien. */
function toHttpError(err) {
  if (err instanceof ValidationError) return { status: 400, message: err.message };
  if (err instanceof NotFoundError) return { status: 404, message: err.message };
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
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' }).end(data);
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

function send(res, status, body) {
  if (body === undefined) return res.writeHead(status).end();
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
}
