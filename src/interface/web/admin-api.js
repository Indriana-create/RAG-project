/** Klien API admin — satu-satunya modul yang mengenal HTTP untuk halaman admin. Sesi memakai cookie HttpOnly, bukan token di JS. */
export function createAdminApi() {
  async function request(path, options = {}) {
    const res = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'content-type': 'application/json' } });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error(data.error ?? 'Permintaan gagal'), { status: res.status, retryAfter: Number(res.headers.get('retry-after')) || 0 });
    }
    return data;
  }
  const json = (method, data = {}) => ({ method, body: JSON.stringify(data) });
  const knowledge = (id) => `/api/admin/knowledge/${encodeURIComponent(id)}`;
  const user = (id) => `/api/admin/users/${encodeURIComponent(id)}`;

  return {
    // akun
    login: (username, password) => request('/api/admin/login', json('POST', { username, password })).then((r) => r.user),
    logout: () => request('/api/admin/logout', json('POST')),
    me: () => request('/api/admin/me').then((r) => r.user),
    changePassword: (currentPassword, newPassword) => request('/api/admin/password', json('POST', { currentPassword, newPassword })).then((r) => r.user),
    users: () => request('/api/admin/users').then((r) => r.items),
    createUser: (data) => request('/api/admin/users', json('POST', data)),
    removeUser: (id) => request(user(id), { method: 'DELETE' }),
    resetPassword: (id, newPassword) => request(`${user(id)}/password`, json('POST', { newPassword })),
    // knowledge
    list: () => request('/api/admin/knowledge').then((r) => r.items),
    get: (id) => request(knowledge(id)),
    create: (data) => request('/api/admin/knowledge', json('POST', data)),
    update: (id, data) => request(knowledge(id), json('PUT', data)),
    search: (query) => request('/api/admin/search', json('POST', { query })),
    remove: (id) => request(knowledge(id), { method: 'DELETE' }),
  };
}
