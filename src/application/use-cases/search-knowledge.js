import { ValidationError } from '../errors.js';

/** Uji pencarian untuk admin: chunk teratas + skornya (tanpa LLM), untuk mengkalibrasi MIN_SCORE. */
export class SearchKnowledge {
  constructor({ retriever, minScore, topK = 5 }) { Object.assign(this, { retriever, minScore, topK }); }

  async execute({ query, signal }) {
    const q = (query ?? '').trim();
    if (!q) throw new ValidationError('Kata kunci tidak boleh kosong');
    if (q.length > 1000) throw new ValidationError('Kata kunci maksimal 1000 karakter');
    const hits = await this.retriever.search(q, this.topK, { signal });
    return {
      minScore: this.minScore,
      hits: hits.map((h) => ({
        documentId: h.chunk.documentId,
        title: h.chunk.title,
        chunk: h.chunk.index,
        score: Math.round(h.score * 1000) / 1000,
        aboveThreshold: h.score >= this.minScore,
        text: h.chunk.text,
      })),
    };
  }
}
