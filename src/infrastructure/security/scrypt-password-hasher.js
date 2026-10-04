import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const DEFAULTS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

const derive = (password, salt, { N, r, p }) =>
  scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r, p, maxmem: 256 * N * r });

/** Adapter PasswordHasher: scrypt (bawaan Node, tanpa dependensi). Format: scrypt$N$r$p$salt$hash — parameter ikut tersimpan. */
export class ScryptPasswordHasher {
  constructor(params = DEFAULTS) { this.params = { ...DEFAULTS, ...params }; }

  async hash(password) {
    const salt = randomBytes(16);
    const key = await derive(password, salt, this.params);
    const { N, r, p } = this.params;
    return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
  }

  async verify(password, stored) {
    const [scheme, N, r, p, salt, key] = String(stored).split('$');
    if (scheme !== 'scrypt' || !key) return false;
    const params = { N: Number(N), r: Number(r), p: Number(p) };
    if (![params.N, params.r, params.p].every((n) => Number.isInteger(n) && n > 0) || params.N > 2 ** 20) return false;
    const expected = Buffer.from(key, 'base64');
    const actual = await derive(password, Buffer.from(salt, 'base64'), params);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
