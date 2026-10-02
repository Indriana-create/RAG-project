import { createMessage, Role } from '../../domain/message.js';
import { ValidationError } from '../errors.js';

const MAX_QUESTION_LENGTH = 1000;
const HISTORY_WINDOW = 6;

/** Use case inti RAG: retrieve konteks → generate jawaban → simpan riwayat. */
export class AskQuestion {
  constructor({ retriever, answerGenerator, history, topK = 3, minScore = 0.05 }) {
    Object.assign(this, { retriever, answerGenerator, history, topK, minScore });
  }

  async execute({ sessionId, question }) {
    const q = (question ?? '').trim();
    if (!sessionId) throw new ValidationError('sessionId wajib diisi');
    if (!q) throw new ValidationError('Pertanyaan tidak boleh kosong');
    if (q.length > MAX_QUESTION_LENGTH) throw new ValidationError(`Pertanyaan maksimal ${MAX_QUESTION_LENGTH} karakter`);

    const previous = (await this.history.list(sessionId)).slice(-HISTORY_WINDOW);
    const hits = (await this.retriever.search(q, this.topK)).filter((h) => h.score >= this.minScore);
    const contexts = hits.map((h) => h.chunk);

    const answer = contexts.length
      ? await this.answerGenerator.generate({ question: q, contexts, history: previous })
      : 'Maaf, saya tidak menemukan informasi tersebut di basis pengetahuan. Coba ubah pertanyaan Anda.';

    const sources = [...new Map(contexts.map((c) => [c.documentId, { id: c.documentId, title: c.title }])).values()];
    await this.history.append(sessionId, createMessage({ role: Role.USER, content: q }));
    const reply = createMessage({ role: Role.ASSISTANT, content: answer, sources });
    await this.history.append(sessionId, reply);
    return reply;
  }
}
