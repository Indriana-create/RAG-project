import { buildPrompt } from '../llm/prompt.js';

/** Adapter AnswerGenerator: memakai Claude via Messages API (fetch, tanpa SDK). Persona & aturan sama dengan LLM lokal. */
export class AnthropicAnswerGenerator {
  constructor({ apiKey, model, persona, fetchImpl = fetch }) { Object.assign(this, { apiKey, model, persona, fetchImpl }); }

  async complete({ system, user, maxTokens = 300, temperature = 0.4, signal }) {
    const res = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] }),
      signal,
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    return (await res.json()).content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  async generate(input) {
    const { system, messages } = buildPrompt({ ...input, persona: { ...this.persona, ...input.persona } });
    const res = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model, max_tokens: 800, system, messages }),
      signal: input.signal,
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }
}
