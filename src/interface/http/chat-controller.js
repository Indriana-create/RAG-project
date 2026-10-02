/** Controller: menerjemahkan HTTP ↔ use case. */
export class ChatController {
  constructor({ askQuestion, getHistory, clearHistory }) {
    Object.assign(this, { askQuestion, getHistory, clearHistory });
  }
  chat = async ({ body }) => ({ status: 200, body: await this.askQuestion.execute(body) });
  history = async ({ params }) => ({ status: 200, body: await this.getHistory.execute(params) });
  clear = async ({ params }) => { await this.clearHistory.execute(params); return { status: 204 }; };
}
