/** Klien API admin — satu-satunya modul yang mengenal HTTP untuk halaman admin. */
export function createAdminApi(getToken) {
  async function request(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken()}` },
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? 'Permintaan gagal'), { status: res.status });
    return data;
  }
  const json = (method, data) => ({ method, body: JSON.stringify(data) });
  const url = (id) => `/api/admin/knowledge/${encodeURIComponent(id)}`;

  return {
    list: () => request('/api/admin/knowledge').then((r) => r.items),
    get: (id) => request(url(id)),
    create: (data) => request('/api/admin/knowledge', json('POST', data)),
    update: (id, data) => request(url(id), json('PUT', data)),
    remove: (id) => request(url(id), { method: 'DELETE' }),
  };
}
