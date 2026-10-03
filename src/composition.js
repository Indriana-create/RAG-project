import { randomUUID } from 'node:crypto';
import { ReindexKnowledge } from './application/use-cases/reindex-knowledge.js';
import { SeedKnowledge } from './application/use-cases/seed-knowledge.js';
import { AskQuestion } from './application/use-cases/ask-question.js';
import { GetHistory, ClearHistory } from './application/use-cases/manage-history.js';
import { SearchKnowledge } from './application/use-cases/search-knowledge.js';
import { ListKnowledge, GetKnowledge, SaveKnowledge, DeleteKnowledge } from './application/use-cases/manage-knowledge.js';
import { FileDocumentSource } from './infrastructure/knowledge/file-document-source.js';
import { InMemoryChatHistory } from './infrastructure/persistence/in-memory-chat-history.js';
import { ChatController } from './interface/http/chat-controller.js';
import { AdminKnowledgeController } from './interface/http/admin-knowledge-controller.js';
import { createTokenAuthenticator } from './interface/http/admin-auth.js';
import { createServer } from './interface/http/server.js';

/**
 * Composition root: merakit use case, controller, dan server dari port yang diberikan.
 * Implementasi konkret (file/PostgreSQL, TF-IDF/pgvector, LLM) dipilih di bootstrap.js.
 */
export async function buildApp({ repository, retriever, answerGenerator, minScore, seed = true, seedDir, publicDir, adminToken }) {
  const history = new InMemoryChatHistory();
  const reindex = new ReindexKnowledge({ repository, retriever });

  const seeded = seed ? await new SeedKnowledge({ repository, documentSource: new FileDocumentSource(seedDir) }).execute() : 0;
  const stats = await reindex.execute();

  const server = createServer({
    chat: new ChatController({
      askQuestion: new AskQuestion({ retriever, answerGenerator, history, minScore }),
      getHistory: new GetHistory({ history }),
      clearHistory: new ClearHistory({ history }),
    }),
    adminKnowledge: new AdminKnowledgeController({
      listKnowledge: new ListKnowledge({ repository }),
      getKnowledge: new GetKnowledge({ repository }),
      saveKnowledge: new SaveKnowledge({ repository, reindex, newId: randomUUID }),
      deleteKnowledge: new DeleteKnowledge({ repository, reindex }),
      searchKnowledge: new SearchKnowledge({ retriever, minScore }),
    }),
    authenticateAdmin: createTokenAuthenticator(adminToken),
    publicDir,
  });
  return { server, stats, seeded };
}
