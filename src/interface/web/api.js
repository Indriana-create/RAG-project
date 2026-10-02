/** Klien API — satu-satunya modul frontend yang mengenal HTTP. */
async function request(path, options) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Permintaan gagal');
  return data;
}

export const api = {
  ask: (sessionId, question) => request('/api/chat', { method: 'POST', body: JSON.stringify({ sessionId, question }) }),
  history: (sessionId) => request(`/api/history/${sessionId}`),
  clear: (sessionId) => request(`/api/history/${sessionId}`, { method: 'DELETE' }),
};
