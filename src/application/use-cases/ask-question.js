import { createMessage, Role } from '../../domain/message.js';
import { UpstreamError } from '../../domain/errors.js';
import { noAnswerMessage } from '../../domain/fallback.js';
import { tokenize } from '../../domain/text.js';
import { ValidationError } from '../errors.js';

const MAX_QUESTION_LENGTH = 1000;
const HISTORY_WINDOW = 6;
const MAX_FOLLOW_UP_TOKENS = 6;
const NO_TOPICS = { titles: async () => [] };
const DEFAULT_PERSONA = { current: async () => ({}) };
const NO_LINKS = { urls: async () => ({}) };
/** Huruf non-Latin (Arab, Mandarin, dst.) tidak punya kata kunci di tokenizer kita, tetapi pencarian makna multibahasa bisa memprosesnya. */
const HAS_NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;

/**
 * Use case inti RAG: retrieve informasi → generate jawaban → simpan riwayat.
 *
 * - Ada informasi yang cocok: LLM menjawab berdasarkan informasi itu.
 * - Tidak ada yang cocok: LLM tetap dipanggil dengan aturan ketat (hanya sapaan / perkenalan / klarifikasi,
 *   tidak boleh memberi fakta), disertai daftar topik. Bila LLM tidak tersedia, dipakai pesan tetap.
 * - Pertanyaan singkat yang tidak menemukan apa pun dianggap lanjutan ("kalau ke Papua?"), sehingga
 *   pencarian diulang dengan menyertakan pertanyaan pengguna sebelumnya.
 */
export class AskQuestion {
  constructor({ retriever, answerGenerator, history, topics = NO_TOPICS, personas = DEFAULT_PERSONA, sourceLinks = NO_LINKS, topK = 3, minScore = 0.05 }) {
    Object.assign(this, { retriever, answerGenerator, history, topics, personas, sourceLinks, topK, minScore });
  }

  /** Jawaban utuh (sekali kirim). */
  async execute({ sessionId, question, signal }) {
    const turn = await this.#prepare({ sessionId, question, signal });
    const input = { question: turn.question, contexts: turn.contexts, history: turn.previous, topics: turn.topics, persona: turn.persona, signal };
    let answer;
    try {
      answer = await this.answerGenerator.generate(input);
    } catch (err) {
      if (!this.#canFallBack(err, turn)) throw err;
      answer = noAnswerMessage(turn.topics);
    }
    return this.#persist(sessionId, turn, answer);
  }

  /**
   * Jawaban bertahap. Menghasilkan event: `sources` → `token`* → `done`.
   * Generator tanpa `stream()` tetap didukung (jawaban dikirim sebagai satu token).
   */
  async *stream({ sessionId, question, signal }) {
    const turn = await this.#prepare({ sessionId, question, signal });
    yield { type: 'sources', sources: turn.sources };

    const input = { question: turn.question, contexts: turn.contexts, history: turn.previous, topics: turn.topics, persona: turn.persona, signal };
    let answer = '';
    try {
      if (typeof this.answerGenerator.stream === 'function') {
        for await (const text of this.answerGenerator.stream(input)) {
          answer += text;
          yield { type: 'token', text };
        }
      } else {
        answer = await this.answerGenerator.generate(input);
        yield { type: 'token', text: answer };
      }
    } catch (err) {
      // Hanya bila belum ada satu token pun yang terkirim ke pengguna.
      if (answer || !this.#canFallBack(err, turn)) throw err;
      answer = noAnswerMessage(turn.topics);
      yield { type: 'token', text: answer };
    }
    yield { type: 'done', message: await this.#persist(sessionId, turn, answer) };
  }

  /** Tanpa informasi yang cocok, kegagalan LLM tidak perlu menggagalkan percakapan: pakai pesan tetap. */
  #canFallBack(err, turn) { return err instanceof UpstreamError && turn.contexts.length === 0; }

  #relevant(hits) { return hits.filter((h) => h.score >= this.minScore); }

  async #prepare({ sessionId, question, signal }) {
    const q = (question ?? '').trim();
    if (!sessionId) throw new ValidationError('sessionId wajib diisi');
    if (!q) throw new ValidationError('Pertanyaan tidak boleh kosong');
    if (q.length > MAX_QUESTION_LENGTH) throw new ValidationError(`Pertanyaan maksimal ${MAX_QUESTION_LENGTH} karakter`);

    const previous = (await this.history.list(sessionId)).slice(-HISTORY_WINDOW);
    // Sapaan / basa-basi ("halo kak", "terima kasih", "kamu siapa?") tidak punya kata isi: jangan cari apa pun.
    const smallTalk = tokenize(q).length === 0 && !HAS_NON_LATIN_LETTER.test(q);
    let hits = smallTalk ? [] : this.#relevant(await this.retriever.search(q, this.topK, { signal }));

    if (!hits.length && !smallTalk) {
      const words = tokenize(q).length;
      const lastQuestion = [...previous].reverse().find((m) => m.role === Role.USER)?.content;
      if (lastQuestion && words >= 1 && words <= MAX_FOLLOW_UP_TOKENS) {
        hits = this.#relevant(await this.retriever.search(`${lastQuestion} ${q}`, this.topK, { signal }));
      }
    }

    const found = [...new Map(hits.map((h) => [h.chunk.documentId, {
      id: h.chunk.documentId, title: h.chunk.title, score: Math.round(h.score * 1000) / 1000,
    }])).values()];
    // Sumber yang punya alamat web dibuat bisa diklik di antarmuka.
    const links = found.length ? await this.sourceLinks.urls(found.map((s) => s.id)) : {};
    const sources = found.map((s) => (links[s.id] ? { ...s, url: links[s.id] } : s));
    const topics = hits.length ? [] : await this.topics.titles();
    return { question: q, previous, contexts: hits.map((h) => h.chunk), sources, topics, persona: await this.personas.current() };
  }

  async #persist(sessionId, turn, answer) {
    if (!answer.trim()) throw new UpstreamError('Jawaban kosong');
    await this.history.append(sessionId, createMessage({ role: Role.USER, content: turn.question }));
    const reply = createMessage({ role: Role.ASSISTANT, content: answer, sources: turn.sources });
    await this.history.append(sessionId, reply);
    return reply;
  }
}
