/** Adapter ChatHistoryRepository: penyimpanan di memori (ganti dengan DB bila perlu). */
export class InMemoryChatHistory {
  #sessions = new Map();
  async append(sessionId, message) {
    if (!this.#sessions.has(sessionId)) this.#sessions.set(sessionId, []);
    this.#sessions.get(sessionId).push(message);
  }
  async list(sessionId) { return [...(this.#sessions.get(sessionId) ?? [])]; }
  async clear(sessionId) { this.#sessions.delete(sessionId); }
}
