import http from 'node:http';

const DIM = 32;

/** Embedding deterministik: bag-of-words di-hash ke 32 dimensi (kata sama → vektor mirip). */
export function fakeEmbed(text) {
  const v = new Array(DIM).fill(0);
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)) {
    let h = 0;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIM] += 1;
  }
  return v;
}

/**
 * Server palsu berprotokol OpenAI: /v1/embeddings dan /v1/chat/completions (termasuk stream).
 * `requests` merekam body yang diterima; `failChat`/`failEmbeddings` memaksa status error.
 */
export async function startFakeLlm({ reply = (messages) => `Jawaban dari model lokal. ${messages.at(-1).content.length} karakter konteks.` } = {}) {
  const state = { requests: [], failChat: 0, failEmbeddings: 0, embeddedTexts: 0 };
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    state.requests.push({ url: req.url, auth: req.headers.authorization, body });
    const json = (status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));

    if (req.url === '/v1/embeddings') {
      if (state.failEmbeddings) return json(state.failEmbeddings, { error: 'embedding rusak' });
      const input = [].concat(body.input);
      state.embeddedTexts += input.length;
      // sengaja dibalik urutannya: klien harus mengurutkan berdasarkan `index`
      return json(200, { data: input.map((t, index) => ({ index, embedding: fakeEmbed(t) })).reverse() });
    }
    if (req.url === '/v1/chat/completions') {
      if (state.failChat) return json(state.failChat, { error: 'model belum dimuat' });
      const text = reply(body.messages);
      if (!body.stream) return json(200, { choices: [{ message: { role: 'assistant', content: text } }] });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const words = text.split(/(?<= )/);
      for (const [i, w] of words.entries()) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: i === 0 ? { role: 'assistant', content: w } : { content: w } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, 2));
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    return json(404, { error: 'tidak ada' });
  });
  await new Promise((r) => server.listen(0, r));
  return { state, baseUrl: `http://localhost:${server.address().port}/v1`, stop: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}
