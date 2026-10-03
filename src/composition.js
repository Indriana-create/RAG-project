import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ReindexKnowledge } from './application/use-cases/reindex-knowledge.js';
import { SeedKnowledge } from './application/use-cases/seed-knowledge.js';
import { AskQuestion } from './application/use-cases/ask-question.js';
import { GetHistory, ClearHistory } from './application/use-cases/manage-history.js';
import { ListKnowledge, GetKnowledge, SaveKnowledge, DeleteKnowledge } from './application/use-cases/manage-knowledge.js';
import { FileDocumentSource } from './infrastructure/knowledge/file-document-source.js';
import { JsonFileKnowledgeRepository } from './infrastructure/persistence/json-file-knowledge-repository.js';
import { InMemoryChatHistory } from './infrastructure/persistence/in-memory-chat-history.js';
import { TfidfRetriever } from './infrastructure/retrieval/tfidf-retriever.js';
import { ExtractiveAnswerGenerator } from './infrastructure/generation/extractive-answer-generator.js';
import { ChatController } from './interface/http/chat-controller.js';
import { AdminKnowledgeController } from './interface/http/admin-knowledge-controller.js';
import { createTokenAuthenticator } from './interface/http/admin-auth.js';
import { createServer } from './interface/http/server.js';

/** Composition root: satu-satunya tempat yang tahu implementasi konkret. */
export async function buildApp({ dataDir, seedDir, publicDir, adminToken, answerGenerator = new ExtractiveAnswerGenerator() }) {
  const repository = new JsonFileKnowledgeRepository(path.join(dataDir, 'knowledge.json'));
  const retriever = new TfidfRetriever();
  const history = new InMemoryChatHistory();
  const reindex = new ReindexKnowledge({ repository, retriever });

  const seeded = await new SeedKnowledge({ repository, documentSource: new FileDocumentSource(seedDir) }).execute();
  const stats = await reindex.execute();

  const server = createServer({
    chat: new ChatController({
      askQuestion: new AskQuestion({ retriever, answerGenerator, history }),
      getHistory: new GetHistory({ history }),
      clearHistory: new ClearHistory({ history }),
    }),
    adminKnowledge: new AdminKnowledgeController({
      listKnowledge: new ListKnowledge({ repository }),
      getKnowledge: new GetKnowledge({ repository }),
      saveKnowledge: new SaveKnowledge({ repository, reindex, newId: randomUUID }),
      deleteKnowledge: new DeleteKnowledge({ repository, reindex }),
    }),
    authenticateAdmin: createTokenAuthenticator(adminToken),
    publicDir,
  });
  return { server, stats, seeded };
}
