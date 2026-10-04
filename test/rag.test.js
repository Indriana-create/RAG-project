import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocument } from '../src/domain/chunk.js';
import { TfidfRetriever } from '../src/infrastructure/retrieval/tfidf-retriever.js';
import { ExtractiveAnswerGenerator } from '../src/infrastructure/generation/extractive-answer-generator.js';
import { InMemoryChatHistory } from '../src/infrastructure/persistence/in-memory-chat-history.js';
import { AskQuestion } from '../src/application/use-cases/ask-question.js';
import { ValidationError } from '../src/application/errors.js';

const docs = [
  { id: 'kirim', title: 'Pengiriman', content: 'Pengiriman ke luar Jawa memakan waktu 5 sampai 9 hari kerja.' },
  { id: 'bayar', title: 'Pembayaran', content: 'Kami menerima QRIS dan transfer bank untuk pembayaran.' },
];

async function build() {
  const retriever = new TfidfRetriever();
  await retriever.index(docs.flatMap((d) => chunkDocument(d)));
  const history = new InMemoryChatHistory();
  return { history, useCase: new AskQuestion({ retriever, answerGenerator: new ExtractiveAnswerGenerator(), history }) };
}

test('chunkDocument memecah paragraf panjang', () => {
  const content = Array.from({ length: 5 }, (_, i) => `Paragraf ${i} `.repeat(30)).join('\n\n');
  assert.ok(chunkDocument({ id: 'x', title: 'X', content }, 400).length > 1);
});

test('retriever menemukan dokumen yang relevan', async () => {
  const { useCase } = await build();
  const reply = await useCase.execute({ sessionId: 's1', question: 'berapa lama pengiriman luar Jawa?' });
  assert.equal(reply.sources[0].id, 'kirim');
  assert.match(reply.content, /5 sampai 9 hari/);
});

test('pertanyaan di luar konteks mendapat fallback tanpa sumber', async () => {
  const { useCase } = await build();
  const reply = await useCase.execute({ sessionId: 's1', question: 'siapa presiden mars?' });
  assert.deepEqual(reply.sources, []);
  assert.match(reply.content, /tidak menemukan/);
});

test('riwayat tersimpan dan validasi input bekerja', async () => {
  const { useCase, history } = await build();
  await useCase.execute({ sessionId: 's2', question: 'metode pembayaran qris' });
  assert.equal((await history.list('s2')).length, 2);
  await assert.rejects(useCase.execute({ sessionId: 's2', question: '  ' }), ValidationError);
});
