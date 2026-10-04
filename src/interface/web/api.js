import { t } from './i18n.js';

/** Klien API — satu-satunya modul frontend yang mengenal HTTP. */
async function request(path, options) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? t('common.requestFailed'));
  return data;
}

/** Memecah stream SSE menjadi objek event JSON. */
async function* readEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const line = block.split('\n').find((l) => l.startsWith('data:'));
      if (line) yield JSON.parse(line.slice(5));
    }
  }
}

export const api = {
  /**
   * Bertanya dengan jawaban bertahap. `onToken(teks)` dipanggil tiap potongan jawaban;
   * mengembalikan pesan akhir ({content, sources}).
   */
  async askStream(sessionId, question, { onToken } = {}) {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, question }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? t('common.requestFailed'));

    let message;
    for await (const event of readEvents(res.body)) {
      if (event.type === 'token') onToken?.(event.text);
      else if (event.type === 'done') message = event.message;
      else if (event.type === 'error') throw new Error(event.message);
    }
    if (!message) throw new Error(t('chat.connectionLost'));
    return message;
  },
  suggestions: () => request('/api/suggestions'),
  history: (sessionId) => request(`/api/history/${sessionId}`),
  clear: (sessionId) => request(`/api/history/${sessionId}`, { method: 'DELETE' }),
};
