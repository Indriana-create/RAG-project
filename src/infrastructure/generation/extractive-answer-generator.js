import { splitSentences, tokenize } from '../../domain/text.js';

/** Adapter AnswerGenerator offline: memilih kalimat paling relevan dari konteks (tanpa LLM). */
export class ExtractiveAnswerGenerator {
  constructor({ maxSentences = 3 } = {}) { this.maxSentences = maxSentences; }

  async generate({ question, contexts }) {
    const q = new Set(tokenize(question));
    const ranked = contexts
      .flatMap((c) => splitSentences(c.text.replace(/^#+\s.*$/gm, '').replace(/[*_`>-]/g, '')).map((s) => ({ s })))
      .map(({ s }) => ({ s, score: tokenize(s).filter((t) => q.has(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.maxSentences);
    return ranked.length ? ranked.map((x) => x.s).join(' ') : contexts[0].text.slice(0, 300);
  }
}
