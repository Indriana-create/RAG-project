import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s) => createHash('sha256').update(s).digest();

/** Autentikasi Bearer token statis; perbandingan constant-time. */
export function createTokenAuthenticator(token) {
  if (!token) throw new Error('Admin token wajib diisi');
  const expected = digest(token);
  return (req) => {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    return Boolean(match) && timingSafeEqual(digest(match[1]), expected);
  };
}
