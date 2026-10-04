import { ValidationError } from './errors.js';

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const PASSWORD_LIMITS = Object.freeze({ min: 8, max: 128 });
export const DISPLAY_NAME_MAX = 60;
export const UserStatus = Object.freeze({ ACTIVE: 'active', PENDING: 'pending' });

export const normalizeUsername = (value) => String(value ?? '').trim().toLowerCase();

/** Aturan password: panjang 8–128 dan bukan sama dengan username. Sengaja tidak memaksa simbol/angka. */
export function assertValidPassword(password, { username } = {}) {
  if (typeof password !== 'string' || password.length < PASSWORD_LIMITS.min) {
    throw new ValidationError(`Password minimal ${PASSWORD_LIMITS.min} karakter`);
  }
  if (password.length > PASSWORD_LIMITS.max) throw new ValidationError(`Password maksimal ${PASSWORD_LIMITS.max} karakter`);
  if (username && password.toLowerCase() === username.toLowerCase()) throw new ValidationError('Password tidak boleh sama dengan username');
}

/** Akun admin. `tokenVersion` dinaikkan saat password berubah sehingga sesi lama otomatis tidak berlaku. */
export function createAdminUser({ id, username, displayName, passwordHash, tokenVersion = 1, createdAt, lastLoginAt = null, status = UserStatus.ACTIVE }) {
  const name = normalizeUsername(username);
  if (!id) throw new ValidationError('id wajib diisi');
  if (!USERNAME_PATTERN.test(name)) {
    throw new ValidationError('Username 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung (diawali huruf/angka)');
  }
  const shown = typeof displayName === 'string' && displayName.trim() ? displayName.trim() : name;
  if (shown.length > DISPLAY_NAME_MAX) throw new ValidationError(`Nama tampilan maksimal ${DISPLAY_NAME_MAX} karakter`);
  if (!passwordHash) throw new ValidationError('passwordHash wajib diisi');
  if (!Object.values(UserStatus).includes(status)) throw new ValidationError('status akun tidak valid');
  return Object.freeze({ id, username: name, displayName: shown, passwordHash, tokenVersion, createdAt, lastLoginAt, status });
}

/** Bentuk yang aman dikirim ke klien: tanpa hash dan versi token. */
export const toPublicUser = ({ id, username, displayName, createdAt, lastLoginAt, status }) => ({ id, username, displayName, createdAt, lastLoginAt, status });
