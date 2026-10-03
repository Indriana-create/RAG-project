import { randomBytes } from 'node:crypto';
import { assertValidPassword, createAdminUser, normalizeUsername, toPublicUser } from '../../domain/admin-user.js';
import { AuthenticationError, ConflictError, NotFoundError, TooManyAttemptsError, ValidationError } from '../errors.js';

const MAX_LOGIN_PASSWORD = 1024;

/** Login admin: verifikasi password + pembatasan percobaan. Pesan gagal sama untuk username salah dan password salah. */
export class LoginAdmin {
  #dummyHash;

  constructor({ users, hasher, sessions, throttle, now = () => new Date() }) {
    Object.assign(this, { users, hasher, sessions, throttle, now });
  }

  async execute({ username, password, ip = 'unknown' }) {
    const name = normalizeUsername(username);
    const keys = [`u:${name}`, `ip:${ip}`];
    const wait = this.throttle.retryAfter(keys);
    if (wait > 0) throw new TooManyAttemptsError(wait);

    const user = name ? await this.users.getByUsername(name) : undefined;
    // Selalu menghitung hash agar waktu respons tidak membocorkan apakah username ada.
    this.#dummyHash ??= await this.hasher.hash(randomBytes(12).toString('hex'));
    const candidate = typeof password === 'string' && password.length <= MAX_LOGIN_PASSWORD ? password : '';
    const matches = await this.hasher.verify(candidate, user?.passwordHash ?? this.#dummyHash);

    if (!user || !matches || !candidate) {
      this.throttle.recordFailure(keys);
      throw new AuthenticationError();
    }
    this.throttle.reset([keys[0]]);
    const updated = { ...user, lastLoginAt: this.now().toISOString() };
    await this.users.save(updated);
    return { user: toPublicUser(updated), token: this.sessions.issue({ userId: user.id, version: user.tokenVersion }) };
  }
}

/** Mengubah token sesi menjadi akun, atau null bila tidak valid / sudah dicabut (password berubah, akun dihapus). */
export class ResolveAdminSession {
  constructor({ users, sessions }) { Object.assign(this, { users, sessions }); }

  async execute(token) {
    const claims = token ? this.sessions.verify(token) : null;
    if (!claims) return null;
    const user = await this.users.get(claims.userId);
    return user && user.tokenVersion === claims.version ? toPublicUser(user) : null;
  }
}

/** Ubah password milik sendiri. Sesi lain dicabut; sesi ini diberi token baru. */
export class ChangeOwnPassword {
  constructor({ users, hasher, sessions }) { Object.assign(this, { users, hasher, sessions }); }

  async execute({ userId, currentPassword, newPassword }) {
    const user = await this.users.get(userId);
    if (!user) throw new AuthenticationError('Sesi tidak valid');
    if (typeof currentPassword !== 'string' || !(await this.hasher.verify(currentPassword, user.passwordHash))) {
      throw new ValidationError('Password saat ini salah');
    }
    assertValidPassword(newPassword, { username: user.username });
    if (newPassword === currentPassword) throw new ValidationError('Password baru harus berbeda dari yang lama');
    const updated = { ...user, passwordHash: await this.hasher.hash(newPassword), tokenVersion: user.tokenVersion + 1 };
    await this.users.save(updated);
    return { user: toPublicUser(updated), token: this.sessions.issue({ userId: user.id, version: updated.tokenVersion }) };
  }
}

export class ListAdminUsers {
  constructor({ users }) { this.users = users; }
  async execute() { return (await this.users.list()).map(toPublicUser); }
}

export class CreateAdminUser {
  constructor({ users, hasher, newId, now = () => new Date() }) { Object.assign(this, { users, hasher, newId, now }); }

  async execute({ username, displayName, password }) {
    const name = normalizeUsername(username);
    assertValidPassword(password, { username: name });
    const user = createAdminUser({
      id: this.newId(), username: name, displayName,
      passwordHash: await this.hasher.hash(password), createdAt: this.now().toISOString(),
    });
    if (await this.users.getByUsername(user.username)) throw new ConflictError(`Username "${user.username}" sudah dipakai`);
    await this.users.save(user);
    return toPublicUser(user);
  }
}

export class DeleteAdminUser {
  constructor({ users }) { this.users = users; }

  async execute({ id, actingUserId }) {
    if (id === actingUserId) throw new ValidationError('Anda tidak bisa menghapus akun yang sedang dipakai');
    const all = await this.users.list();
    if (!all.some((u) => u.id === id)) throw new NotFoundError('Akun tidak ditemukan');
    if (all.length <= 1) throw new ValidationError('Akun admin terakhir tidak bisa dihapus');
    await this.users.delete(id);
  }
}

/** Reset password akun LAIN oleh admin; sesi akun itu dicabut. (Akun sendiri: ChangeOwnPassword.) */
export class ResetAdminPassword {
  constructor({ users, hasher }) { Object.assign(this, { users, hasher }); }

  async execute({ id, newPassword, actingUserId }) {
    if (id === actingUserId) throw new ValidationError('Untuk mengubah password sendiri, gunakan "Ubah password"');
    const user = await this.users.get(id);
    if (!user) throw new NotFoundError('Akun tidak ditemukan');
    assertValidPassword(newPassword, { username: user.username });
    await this.users.save({ ...user, passwordHash: await this.hasher.hash(newPassword), tokenVersion: user.tokenVersion + 1 });
  }
}

const generatePassword = () => randomBytes(9).toString('base64url'); // 12 karakter

/** Membuat akun admin pertama bila belum ada satu pun. Tanpa password dari konfigurasi, password acak dibuat sekali. */
export class SeedAdminUser {
  constructor({ users, hasher, newId, now = () => new Date() }) { Object.assign(this, { users, hasher, newId, now }); }

  async execute({ username = 'admin', password } = {}) {
    if ((await this.users.list()).length > 0) return { created: false };
    const generated = password ? undefined : generatePassword();
    const plain = password ?? generated;
    const name = normalizeUsername(username);
    assertValidPassword(plain, { username: name });
    await this.users.save(createAdminUser({
      id: this.newId(), username: name, passwordHash: await this.hasher.hash(plain), createdAt: this.now().toISOString(),
    }));
    return { created: true, username: name, generatedPassword: generated };
  }
}
