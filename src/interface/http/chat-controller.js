/** Controller: menerjemahkan HTTP ↔ use case. */
export class ChatController {
  constructor({ askQuestion, getHistory, clearHistory, getSuggestions }) {
    Object.assign(this, { askQuestion, getHistory, clearHistory, getSuggestions });
  }
  chat = async ({ body, signal }) => ({ status: 200, body: await this.askQuestion.execute({ ...body, signal }) });
  /** Mengalirkan jawaban sebagai Server-Sent Events. */
  chatStream = async ({ body, signal }) => ({ status: 200, stream: this.askQuestion.stream({ ...body, signal }) });
  /** Saran pertanyaan untuk layar awal (publik): yang diatur admin, atau judul knowledge aktif. */
  suggestions = async () => ({ status: 200, body: await this.getSuggestions.execute() });
  history = async ({ params }) => ({ status: 200, body: await this.getHistory.execute(params) });
  clear = async ({ params }) => { await this.clearHistory.execute(params); return { status: 204 }; };
}
