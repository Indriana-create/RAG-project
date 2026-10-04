import { createHmac, timingSafeEqual } from 'node:crypto';

const b64 = (buffer) => Buffer.from(buffer).toString('base64url');

/**
 * Adapter SessionTokens: token tanpa-status bertanda tangan HMAC-SHA256 (`payload.tanda-tangan`).
 * Pencabutan lewat `version` akun (naik saat password berubah). Logout hanya menghapus cookie.
 */
export class HmacSessionTokens {
  constructor({ secret, ttlSeconds = 12 * 3600, now = () => Date.now() }) {
    if (!secret || secret.length < 16) throw new Error('Rahasia sesi terlalu pendek');
    Object.assign(this, { secret, ttlSeconds, now });
  }

  #sign(payload) { return createHmac('sha256', this.secret).update(payload).digest(); }

  issue({ userId, version }) {
    const payload = b64(JSON.stringify({ u: userId, v: version, e: Math.floor(this.now() / 1000) + this.ttlSeconds }));
    return `${payload}.${b64(this.#sign(payload))}`;
  }

  verify(token) {
    if (typeof token !== 'string') return null;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return null;
    const expected = this.#sign(payload);
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const { u, v, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (typeof u !== 'string' || !Number.isInteger(v) || !Number.isFinite(e) || e * 1000 <= this.now()) return null;
      return { userId: u, version: v };
    } catch {
      return null;
    }
  }
}
