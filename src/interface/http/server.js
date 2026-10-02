import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ValidationError } from '../../application/errors.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

export function createServer({ controller, publicDir }) {
  const routes = [
    ['GET', /^\/api\/health$/, async () => ({ status: 200, body: { ok: true } })],
    ['POST', /^\/api\/chat$/, controller.chat],
    ['GET', /^\/api\/history\/([\w-]+)$/, controller.history],
    ['DELETE', /^\/api\/history\/([\w-]+)$/, controller.clear],
  ];

  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/api/')) {
        for (const [method, pattern, handler] of routes) {
          const m = pathname.match(pattern);
          if (m && req.method === method) {
            const out = await handler({ body: method === 'POST' ? await readJson(req) : undefined, params: { sessionId: m[1] } });
            return send(res, out.status, out.body);
          }
        }
        return send(res, 404, { error: 'Tidak ditemukan' });
      }
      return await serveStatic(res, publicDir, pathname);
    } catch (err) {
      if (err instanceof ValidationError) return send(res, 400, { error: err.message });
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
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(data);
  } catch {
    send(res, 404, { error: 'Tidak ditemukan' });
  }
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e5) throw new ValidationError('Payload terlalu besar');
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new ValidationError('JSON tidak valid'); }
}

function send(res, status, body) {
  if (body === undefined) return res.writeHead(status).end();
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
}
