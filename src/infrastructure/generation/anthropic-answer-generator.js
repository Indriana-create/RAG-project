const SYSTEM_PROMPT =
  'Anda asisten yang menjawab HANYA berdasarkan konteks yang diberikan. Jawab singkat dalam bahasa pengguna. ' +
  'Jika konteks tidak memuat jawabannya, katakan tidak tahu.';

/** Adapter AnswerGenerator: memakai Claude via Messages API (fetch, tanpa SDK). */
export class AnthropicAnswerGenerator {
  constructor({ apiKey, model, fetchImpl = fetch }) { Object.assign(this, { apiKey, model, fetchImpl }); }

  async generate({ question, contexts, history }) {
    const context = contexts.map((c, i) => `[${i + 1}] ${c.title}\n${c.text}`).join('\n\n');
    const res = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: `Konteks:\n${context}\n\nPertanyaan: ${question}` }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }
}
