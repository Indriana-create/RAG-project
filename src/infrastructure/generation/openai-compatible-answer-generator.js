import { UpstreamError } from '../../domain/errors.js';
import { authHeaders, joinUrl, postJson } from '../llm/http.js';
import { buildMessages } from '../llm/prompt.js';
import { readSse } from '../llm/sse.js';
import { stripThinking, ThinkFilter } from '../llm/think-filter.js';

/**
 * Adapter AnswerGenerator untuk server LLM lokal berprotokol OpenAI
 * (LM Studio, vLLM, llama.cpp server, Ollama /v1). Mendukung streaming token.
 *
 * `extraBody`: field tambahan yang diteruskan ke body permintaan (mis. vLLM:
 * `{ chat_template_kwargs: { enable_thinking: false } }`). Field inti (model, messages, stream) tidak bisa ditimpa.
 * Blok `<think>…</think>` dibuang dari jawaban.
 */
export class OpenAiCompatibleAnswerGenerator {
  constructor({ baseUrl, model, apiKey, persona, temperature = 0.3, maxTokens = 800, timeoutMs = 300_000, extraBody = {}, fetchImpl = fetch }) {
    if (!baseUrl) throw new Error('LLM_BASE_URL wajib diisi');
    if (!model) throw new Error('LLM_MODEL wajib diisi');
    Object.assign(this, { baseUrl, model, apiKey, persona, temperature, maxTokens, timeoutMs, extraBody, fetchImpl });
  }

  #request(input, stream) {
    return postJson(joinUrl(this.baseUrl, '/chat/completions'), {
      headers: authHeaders(this.apiKey),
      body: { ...this.extraBody, model: this.model, messages: buildMessages({ ...input, persona: this.persona }), temperature: this.temperature, max_tokens: this.maxTokens, stream },
      signal: input.signal,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      what: 'LLM',
    });
  }

  async generate(input) {
    const data = await (await this.#request(input, false)).json();
    const raw = data.choices?.[0]?.message?.content;
    const text = typeof raw === 'string' ? stripThinking(raw) : '';
    if (!text) throw new UpstreamError('LLM tidak mengembalikan jawaban');
    return text;
  }

  async *stream(input) {
    const res = await this.#request(input, true);
    const filter = new ThinkFilter();
    let produced = false;
    for await (const data of readSse(res.body)) {
      const token = data.choices?.[0]?.delta?.content;
      const text = token ? filter.push(token) : '';
      if (text) { produced = true; yield text; }
    }
    const rest = filter.flush();
    if (rest) { produced = true; yield rest; }
    if (!produced) throw new UpstreamError('LLM tidak mengembalikan jawaban');
  }
}
