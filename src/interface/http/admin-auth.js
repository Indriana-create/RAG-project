import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s) => createHash('sha256').update(s).digest();

/** Autentikasi Bearer token statis untuk otomasi (mis. n8n); perbandingan constant-time. Tanpa token = dinonaktifkan. */
export function createTokenAuthenticator(token) {
  if (!token) return () => false;
  const expected = digest(token);
  return (req) => {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    return Boolean(match) && timingSafeEqual(digest(match[1]), expected);
  };
}
