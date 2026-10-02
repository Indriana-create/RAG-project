import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IngestKnowledge } from './application/use-cases/ingest-knowledge.js';
import { AskQuestion } from './application/use-cases/ask-question.js';
import { GetHistory, ClearHistory } from './application/use-cases/manage-history.js';
import { FileDocumentSource } from './infrastructure/knowledge/file-document-source.js';
import { TfidfRetriever } from './infrastructure/retrieval/tfidf-retriever.js';
import { ExtractiveAnswerGenerator } from './infrastructure/generation/extractive-answer-generator.js';
import { AnthropicAnswerGenerator } from './infrastructure/generation/anthropic-answer-generator.js';
import { InMemoryChatHistory } from './infrastructure/persistence/in-memory-chat-history.js';
import { ChatController } from './interface/http/chat-controller.js';
import { createServer } from './interface/http/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { PORT = 3000, KNOWLEDGE_DIR = path.join(root, 'knowledge'), ANTHROPIC_API_KEY, ANTHROPIC_MODEL = 'claude-sonnet-5-5' } = process.env;

// Composition root: satu-satunya tempat yang tahu implementasi konkret.
const retriever = new TfidfRetriever();
const history = new InMemoryChatHistory();
const answerGenerator = ANTHROPIC_API_KEY
  ? new AnthropicAnswerGenerator({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL })
  : new ExtractiveAnswerGenerator();

const stats = await new IngestKnowledge({ documentSource: new FileDocumentSource(KNOWLEDGE_DIR), retriever }).execute();
const controller = new ChatController({
  askQuestion: new AskQuestion({ retriever, answerGenerator, history }),
  getHistory: new GetHistory({ history }),
  clearHistory: new ClearHistory({ history }),
});

createServer({ controller, publicDir: path.join(root, 'src/interface/web') }).listen(PORT, () =>
  console.log(`http://localhost:${PORT} — ${stats.documents} dokumen, ${stats.chunks} chunk, generator: ${ANTHROPIC_API_KEY ? 'Claude' : 'ekstraktif (offline)'}`));
