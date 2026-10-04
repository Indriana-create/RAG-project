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
    assert.match(body.messages.at(-1).content, /Informasi resmi:\n\[1\] Garansi\nGaransi 24 bulan\./);
    assert.match(body.messages.at(-1).content, /Pesan pengguna: berapa lama garansi\?/);
    assert.match(body.messages[0].content, /ATURAN KEJUJURAN/);
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

    // di luar konteks: LLM tetap dipanggil (mode ketat), tanpa sumber
    const before = llm.state.requests.length;
    const out = [];
    for await (const e of ask.stream({ sessionId: 's2', question: 'siapa presiden mars?' })) out.push(e);
    assert.deepEqual(out[0].sources, []);
    assert.equal(llm.state.requests.length, before + 1);
    assert.match(llm.state.requests.at(-1).body.messages[0].content, /KONDISI SAAT INI: tidak ada informasi resmi/);
  } finally { await llm.stop(); }
});

import { ThinkFilter, stripThinking } from '../src/infrastructure/llm/think-filter.js';
import { createDependencies } from '../src/bootstrap.js';

test('stripThinking membuang blok think (termasuk yang tidak ditutup)', () => {
  assert.equal(stripThinking('<think>mikir dulu</think>\n\nJawabannya 24 bulan.'), 'Jawabannya 24 bulan.');
  assert.equal(stripThinking('A<think>x</think>B<think>y</think>C'), 'ABC');
  assert.equal(stripThinking('Jawaban<think>terpotong'), 'Jawaban');
  assert.equal(stripThinking('Tanpa tag.'), 'Tanpa tag.');
});

test('ThinkFilter: benar walau tag terpotong di batas potongan (diuji per karakter)', () => {
  const text = '<think>\nSaya perlu mencari 24 < 36 dulu.\n</think>\n\nGaransi berlaku 24 bulan <b>penuh</b>.';
  const filter = new ThinkFilter();
  let out = '';
  for (const ch of text) out += filter.push(ch);
  out += filter.flush();
  assert.equal(out, 'Garansi berlaku 24 bulan <b>penuh</b>.');
  // potongan acak tidak mengubah hasil
  for (const size of [2, 3, 5, 7, 11]) {
    const f = new ThinkFilter();
    let result = '';
    for (let i = 0; i < text.length; i += size) result += f.push(text.slice(i, i + size));
    assert.equal(result + f.flush(), 'Garansi berlaku 24 bulan <b>penuh</b>.', `size ${size}`);
  }
  // awalan tag palsu di akhir stream tetap dikeluarkan
  const g = new ThinkFilter();
  assert.equal(g.push('a <thi') + g.flush(), 'a <thi');
});

test('generator: think dibuang di mode utuh dan stream; extraBody diteruskan tanpa menimpa field inti', async () => {
  const llm = await startFakeLlm({ reply: () => '<think>pertimbangan panjang</think>\n\nGaransi 24 bulan.' });
  try {
    const gen = new OpenAiCompatibleAnswerGenerator({
      baseUrl: llm.baseUrl, model: 'asli',
      extraBody: { chat_template_kwargs: { enable_thinking: false }, model: 'dibajak', stream: 'x', top_k: 20 },
    });
    assert.equal(await gen.generate(input), 'Garansi 24 bulan.');
    let streamed = '';
    for await (const t of gen.stream(input)) streamed += t;
    assert.equal(streamed, 'Garansi 24 bulan.');
    const [first, second] = llm.state.requests.map((r) => r.body);
    assert.deepEqual(first.chat_template_kwargs, { enable_thinking: false });
    assert.equal(first.top_k, 20);
    assert.equal(first.model, 'asli');
    assert.equal(first.stream, false);
    assert.equal(second.stream, true);
  } finally { await llm.stop(); }
});

test('generator: jawaban yang seluruhnya "berpikir" dianggap kosong (UpstreamError)', async () => {
  const llm = await startFakeLlm({ reply: () => '<think>hanya berpikir tanpa jawaban' });
  try {
    const gen = new OpenAiCompatibleAnswerGenerator({ baseUrl: llm.baseUrl, model: 'm' });
    await assert.rejects(gen.generate(input), UpstreamError);
    await assert.rejects(async () => { for await (const _ of gen.stream(input)); }, UpstreamError);
  } finally { await llm.stop(); }
});

test('bootstrap: LLM_EXTRA_BODY divalidasi', async () => {
  const base = { DATA_DIR: './data-uji', LLM_BASE_URL: 'http://x/v1', LLM_MODEL: 'm' };
  await assert.rejects(createDependencies({ ...base, LLM_EXTRA_BODY: '{rusak' }), /LLM_EXTRA_BODY harus berupa JSON/);
  await assert.rejects(createDependencies({ ...base, LLM_EXTRA_BODY: '[1]' }), /objek JSON/);
  const ok = await createDependencies({ ...base, LLM_EXTRA_BODY: '{"chat_template_kwargs":{"enable_thinking":false}}' });
  assert.match(ok.description.generator, /LLM lokal \(m @ http:\/\/x\/v1\)/);
});
