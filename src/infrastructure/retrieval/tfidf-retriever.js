import { tokenize } from '../../domain/text.js';

/** Adapter Retriever: TF-IDF + cosine similarity, in-memory & tanpa dependensi. */
export class TfidfRetriever {
  #entries = [];
  #idf = new Map();

  async index(chunks) {
    const docs = chunks.map((chunk) => ({ chunk, tf: termFreq(tokenize(`${chunk.title} ${chunk.text}`)) }));
    const df = new Map();
    for (const { tf } of docs) for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    this.#idf = new Map([...df].map(([t, n]) => [t, Math.log(1 + docs.length / n)]));
    this.#entries = docs.map(({ chunk, tf }) => {
      const vec = this.#weigh(tf);
      return { chunk, vec, norm: norm(vec) };
    });
  }

  async search(query, topK) {
    const qvec = this.#weigh(termFreq(tokenize(query)));
    const qnorm = norm(qvec);
    if (!qnorm) return [];
    return this.#entries
      .map(({ chunk, vec, norm: n }) => {
        let dot = 0;
        for (const [t, w] of qvec) dot += w * (vec.get(t) ?? 0);
        return { chunk, score: n ? dot / (qnorm * n) : 0 };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /** Chunk bertetangga (indeks ±radius pada dokumen yang sama) dari chunk yang diberikan, tanpa chunk itu sendiri. */
  async neighbors(chunks, { radius = 1 } = {}) {
    const wanted = new Set();
    for (const c of chunks) for (let d = -radius; d <= radius; d += 1) if (d !== 0) wanted.add(`${c.documentId}#${c.index + d}`);
    return this.#entries.filter(({ chunk }) => wanted.has(chunk.id)).map(({ chunk }) => chunk);
  }

  #weigh(tf) {
    return new Map([...tf].filter(([t]) => this.#idf.has(t)).map(([t, f]) => [t, f * this.#idf.get(t)]));
  }
}

const termFreq = (tokens) => tokens.reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map());
const norm = (vec) => Math.sqrt([...vec.values()].reduce((s, w) => s + w * w, 0));
