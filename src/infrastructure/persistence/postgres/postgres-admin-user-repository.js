import { createAdminUser } from '../../../domain/admin-user.js';
import { ConflictError } from '../../../domain/errors.js';

const toUser = (row) => createAdminUser({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  passwordHash: row.password_hash,
  tokenVersion: row.token_version,
  createdAt: row.created_at.toISOString(),
  lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
});

/** Adapter AdminUserRepository di atas PostgreSQL (menerima `pg.Pool`). */
export class PostgresAdminUserRepository {
  constructor(pool) { this.pool = pool; }

  async list() { return (await this.pool.query('SELECT * FROM admin_users ORDER BY created_at, username')).rows.map(toUser); }

  async get(id) {
    const { rows } = await this.pool.query('SELECT * FROM admin_users WHERE id = $1', [id]);
    return rows[0] && toUser(rows[0]);
  }

  async getByUsername(username) {
    const { rows } = await this.pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    return rows[0] && toUser(rows[0]);
  }

  async save(user) {
    try {
      await this.pool.query(
        `INSERT INTO admin_users (id, username, display_name, password_hash, token_version, created_at, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, display_name = EXCLUDED.display_name,
           password_hash = EXCLUDED.password_hash, token_version = EXCLUDED.token_version, last_login_at = EXCLUDED.last_login_at`,
        [user.id, user.username, user.displayName, user.passwordHash, user.tokenVersion, user.createdAt, user.lastLoginAt]);
    } catch (err) {
      if (err.code === '23505') throw new ConflictError(`Username "${user.username}" sudah dipakai`);
      throw err;
    }
  }

  async delete(id) {
    const { rowCount } = await this.pool.query('DELETE FROM admin_users WHERE id = $1', [id]);
    return rowCount > 0;
  }
}
