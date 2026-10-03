/** Adapter SettingsRepository di atas PostgreSQL (tabel app_settings). */
export class PostgresSettingsRepository {
  constructor(pool) { this.pool = pool; }

  async get(key) {
    const { rows } = await this.pool.query('SELECT value, updated_at, updated_by FROM app_settings WHERE key = $1', [key]);
    return rows[0] && { value: rows[0].value, updatedAt: rows[0].updated_at.toISOString(), updatedBy: rows[0].updated_by };
  }

  async set(key, { value, updatedAt, updatedBy }) {
    await this.pool.query(
      `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [key, JSON.stringify(value), updatedAt, updatedBy]);
  }
}
