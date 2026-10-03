import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NotFoundError, ValidationError } from '../../application/errors.js';

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
    route('GET', '/api/history/:sessionId', chat.history),
    route('DELETE', '/api/history/:sessionId', chat.clear),
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
        const out = await handler({ body, params: { ...match.groups } });
        return send(res, out.status, out.body);
      }
      return send(res, 404, { error: 'Tidak ditemukan' });
    } catch (err) {
      if (err instanceof ValidationError) return send(res, 400, { error: err.message });
      if (err instanceof NotFoundError) return send(res, 404, { error: err.message });
      console.error(err);
      return send(res, 500, { error: 'Terjadi kesalahan pada server' });
    }
  });
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
