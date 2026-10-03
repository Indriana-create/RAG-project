import { createMessage, Role } from '../../domain/message.js';
import { UpstreamError } from '../../domain/errors.js';
import { ValidationError } from '../errors.js';

const MAX_QUESTION_LENGTH = 1000;
const HISTORY_WINDOW = 6;
const NO_CONTEXT_ANSWER = 'Maaf, saya tidak menemukan informasi tersebut di basis pengetahuan. Coba ubah pertanyaan Anda.';

/** Use case inti RAG: retrieve konteks → generate jawaban → simpan riwayat. */
export class AskQuestion {
  constructor({ retriever, answerGenerator, history, topK = 3, minScore = 0.05 }) {
    Object.assign(this, { retriever, answerGenerator, history, topK, minScore });
  }

  /** Jawaban utuh (sekali kirim). */
  async execute({ sessionId, question, signal }) {
    const turn = await this.#prepare({ sessionId, question, signal });
    const answer = turn.contexts.length
      ? await this.answerGenerator.generate({ question: turn.question, contexts: turn.contexts, history: turn.previous, signal })
      : NO_CONTEXT_ANSWER;
    return this.#persist(sessionId, turn, answer);
  }

  /**
   * Jawaban bertahap. Menghasilkan event: `sources` → `token`* → `done`.
   * Generator tanpa `stream()` tetap didukung (jawaban dikirim sebagai satu token).
   */
  async *stream({ sessionId, question, signal }) {
    const turn = await this.#prepare({ sessionId, question, signal });
    yield { type: 'sources', sources: turn.sources };

    let answer = '';
    if (!turn.contexts.length) {
      answer = NO_CONTEXT_ANSWER;
      yield { type: 'token', text: answer };
    } else if (typeof this.answerGenerator.stream === 'function') {
      const input = { question: turn.question, contexts: turn.contexts, history: turn.previous, signal };
      for await (const text of this.answerGenerator.stream(input)) {
        answer += text;
        yield { type: 'token', text };
      }
    } else {
      answer = await this.answerGenerator.generate({ question: turn.question, contexts: turn.contexts, history: turn.previous, signal });
      yield { type: 'token', text: answer };
    }
    yield { type: 'done', message: await this.#persist(sessionId, turn, answer) };
  }

  async #prepare({ sessionId, question, signal }) {
    const q = (question ?? '').trim();
    if (!sessionId) throw new ValidationError('sessionId wajib diisi');
    if (!q) throw new ValidationError('Pertanyaan tidak boleh kosong');
    if (q.length > MAX_QUESTION_LENGTH) throw new ValidationError(`Pertanyaan maksimal ${MAX_QUESTION_LENGTH} karakter`);

    const previous = (await this.history.list(sessionId)).slice(-HISTORY_WINDOW);
    const hits = (await this.retriever.search(q, this.topK, { signal })).filter((h) => h.score >= this.minScore);
    const sources = [...new Map(hits.map((h) => [h.chunk.documentId, {
      id: h.chunk.documentId, title: h.chunk.title, score: Math.round(h.score * 1000) / 1000,
    }])).values()];
    return { question: q, previous, contexts: hits.map((h) => h.chunk), sources };
  }

  async #persist(sessionId, turn, answer) {
    if (!answer.trim()) throw new UpstreamError('Jawaban kosong');
    await this.history.append(sessionId, createMessage({ role: Role.USER, content: turn.question }));
    const reply = createMessage({ role: Role.ASSISTANT, content: answer, sources: turn.sources });
    await this.history.append(sessionId, reply);
    return reply;
  }
}
