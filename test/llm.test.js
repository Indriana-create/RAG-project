import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeLlm, fakeEmbed } from './helpers/fake-llm.js';
import { OpenAiCompatibleAnswerGenerator } from '../src/infrastructure/generation/openai-compatible-answer-generator.js';
import { OpenAiCompatibleEmbedder } from '../src/infrastructure/embedding/openai-compatible-embedder.js';
import { UpstreamError } from '../src/domain/errors.js';
import { AskQuestion } from '../src/application/use-cases/ask-question.js';
import { InMemoryChatHistory } from '../src/infrastructure/persistence/in-memory-chat-history.js';
import { TfidfRetriever } from '../src/infrastructure/retrieval/tfidf-retriever.js';
import { chunkDocument } from '../src/domain/chunk.js';

const input = {
  question: 'berapa lama garansi?',
  contexts: [{ title: 'Garansi', text: 'Garansi 24 bulan.' }],
  history: [{ role: 'user', content: 'halo' }, { role: 'assistant', content: 'hai' }],
};

test('generator OpenAI-compatible: mengirim pesan yang benar dan membaca jawaban', async () => {
  const llm = await startFakeLlm({ reply: () => 'Garansi 24 bulan.' });
  try {
    const gen = new OpenAiCompatibleAnswerGenerator({ baseUrl: llm.baseUrl + '/', model: 'qwen', apiKey: 'kunci' });
    assert.equal(await gen.generate(input), 'Garansi 24 bulan.');
    const { body, auth, url } = llm.state.requests[0];
    assert.equal(url, '/v1/chat/completions');
    assert.equal(auth, 'Bearer kunci');
    assert.equal(body.model, 'qwen');
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
    assert.match(body.messages.at(-1).content, /\[1\] Garansi\nGaransi 24 bulan\./);
    assert.match(body.messages.at(-1).content, /Pertanyaan: berapa lama garansi\?/);
  } finally { await llm.stop(); }
});

test('generator OpenAI-compatible: streaming mengalirkan token berurutan', async () => {
  const llm = await startFakeLlm({ reply: () => 'Garansi resmi berlaku 24 bulan.' });
  try {
    const gen = new OpenAiCompatibleAnswerGenerator({ baseUrl: llm.baseUrl, model: 'm' });
    const tokens = [];
    for await (const t of gen.stream(input)) tokens.push(t);
    assert.ok(tokens.length > 1, 'harus lebih dari satu potongan');
    assert.equal(tokens.join(''), 'Garansi resmi berlaku 24 bulan.');
    assert.equal(llm.state.requests[0].body.stream, true);
    assert.equal(llm.state.requests[0].auth, undefined);
  } finally { await llm.stop(); }
});

test('generator: error HTTP/koneksi menjadi UpstreamError; abort klien tidak', async () => {
  const llm = await startFakeLlm();
  const gen = new OpenAiCompatibleAnswerGenerator({ baseUrl: llm.baseUrl, model: 'm' });
  llm.state.failChat = 503;
  await assert.rejects(gen.generate(input), (e) => e instanceof UpstreamError && /503/.test(e.message));
  await assert.rejects(async () => { for await (const _ of gen.stream(input)); }, UpstreamError);
  llm.state.failChat = 0;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(gen.generate({ ...input, signal: controller.signal }), (e) => !(e instanceof UpstreamError));
  await llm.stop();

  const down = new OpenAiCompatibleAnswerGenerator({ baseUrl: 'http://localhost:1/v1', model: 'm' });
  await assert.rejects(down.generate(input), (e) => e instanceof UpstreamError && /tidak dapat dihubungi/.test(e.message));
  assert.throws(() => new OpenAiCompatibleAnswerGenerator({ baseUrl: 'http://x/v1' }), /LLM_MODEL/);
});

test('embedder: batching, urutan berdasarkan index, dan validasi', async () => {
  const llm = await startFakeLlm();
  try {
    const embedder = new OpenAiCompatibleEmbedder({ baseUrl: llm.baseUrl, model: 'emb', batchSize: 2 });
    const texts = ['garansi produk', 'kirim luar jawa', 'metode bayar qris', 'jam layanan'];
    const vectors = await embedder.embed(texts);
    assert.equal(llm.state.requests.length, 2); // 4 teks / batch 2
    assert.deepEqual(vectors, texts.map(fakeEmbed)); // urutan benar walau server membalik
    llm.state.failEmbeddings = 500;
    await assert.rejects(embedder.embed(['x']), UpstreamError);
  } finally { await llm.stop(); }
});

test('AskQuestion.stream: urutan event sources → token → done dan riwayat tersimpan', async () => {
  const retriever = new TfidfRetriever();
  await retriever.index(chunkDocument({ id: 'g', title: 'Garansi', content: 'Garansi resmi produk berlaku 24 bulan.' }));
  const history = new InMemoryChatHistory();
  const llm = await startFakeLlm({ reply: () => 'Berlaku 24 bulan sesuai dokumen.' });
  try {
    const generator = new OpenAiCompatibleAnswerGenerator({ baseUrl: llm.baseUrl, model: 'm' });
    const ask = new AskQuestion({ retriever, answerGenerator: generator, history });
    const events = [];
    for await (const e of ask.stream({ sessionId: 's', question: 'berapa lama garansi produk?' })) events.push(e);
    assert.equal(events[0].type, 'sources');
    assert.equal(events[0].sources[0].id, 'g');
    assert.ok(events[0].sources[0].score > 0);
    assert.equal(events.at(-1).type, 'done');
    assert.equal(events.filter((e) => e.type === 'token').map((e) => e.text).join(''), 'Berlaku 24 bulan sesuai dokumen.');
    assert.equal((await history.list('s')).length, 2);

    // di luar konteks: tanpa memanggil LLM
    const before = llm.state.requests.length;
    const out = [];
    for await (const e of ask.stream({ sessionId: 's2', question: 'siapa presiden mars?' })) out.push(e);
    assert.deepEqual(out[0].sources, []);
    assert.equal(llm.state.requests.length, before);
  } finally { await llm.stop(); }
});
