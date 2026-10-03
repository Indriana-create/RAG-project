import { UpstreamError } from '../../domain/errors.js';
import { authHeaders, joinUrl, postJson } from '../llm/http.js';

/** Adapter Embedder untuk endpoint `/v1/embeddings` OpenAI-compatible. */
export class OpenAiCompatibleEmbedder {
  constructor({ baseUrl, model, apiKey, batchSize = 16, timeoutMs = 120_000, fetchImpl = fetch }) {
    if (!baseUrl) throw new Error('EMBEDDING_BASE_URL wajib diisi');
    if (!model) throw new Error('EMBEDDING_MODEL wajib diisi');
    Object.assign(this, { baseUrl, model, apiKey, batchSize, timeoutMs, fetchImpl });
  }

  async embed(texts, { signal } = {}) {
    const vectors = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const res = await postJson(joinUrl(this.baseUrl, '/embeddings'), {
        headers: authHeaders(this.apiKey),
        body: { model: this.model, input: batch },
        signal,
        timeoutMs: this.timeoutMs,
        fetchImpl: this.fetchImpl,
        what: 'Embedding',
      });
      const data = (await res.json()).data;
      if (!Array.isArray(data) || data.length !== batch.length || data.some((d) => !Array.isArray(d.embedding))) {
        throw new UpstreamError('Embedding membalas format yang tidak valid');
      }
      vectors.push(...[...data].sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return vectors;
  }
}
