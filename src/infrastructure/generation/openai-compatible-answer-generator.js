import { UpstreamError } from '../../domain/errors.js';
import { authHeaders, joinUrl, postJson } from '../llm/http.js';
import { buildMessages } from '../llm/prompt.js';
import { readSse } from '../llm/sse.js';

/**
 * Adapter AnswerGenerator untuk server LLM lokal berprotokol OpenAI
 * (LM Studio, vLLM, llama.cpp server, Ollama /v1). Mendukung streaming token.
 */
export class OpenAiCompatibleAnswerGenerator {
  constructor({ baseUrl, model, apiKey, temperature = 0.2, maxTokens = 800, timeoutMs = 300_000, fetchImpl = fetch }) {
    if (!baseUrl) throw new Error('LLM_BASE_URL wajib diisi');
    if (!model) throw new Error('LLM_MODEL wajib diisi');
    Object.assign(this, { baseUrl, model, apiKey, temperature, maxTokens, timeoutMs, fetchImpl });
  }

  #request(input, stream) {
    return postJson(joinUrl(this.baseUrl, '/chat/completions'), {
      headers: authHeaders(this.apiKey),
      body: { model: this.model, messages: buildMessages(input), temperature: this.temperature, max_tokens: this.maxTokens, stream },
      signal: input.signal,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      what: 'LLM',
    });
  }

  async generate(input) {
    const data = await (await this.#request(input, false)).json();
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new UpstreamError('LLM tidak mengembalikan jawaban');
    return text.trim();
  }

  async *stream(input) {
    const res = await this.#request(input, true);
    let produced = false;
    for await (const data of readSse(res.body)) {
      const token = data.choices?.[0]?.delta?.content;
      if (token) { produced = true; yield token; }
    }
    if (!produced) throw new UpstreamError('LLM tidak mengembalikan jawaban');
  }
}
