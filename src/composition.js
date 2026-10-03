import { randomBytes, randomUUID } from 'node:crypto';
import { ReindexKnowledge } from './application/use-cases/reindex-knowledge.js';
import { SeedKnowledge } from './application/use-cases/seed-knowledge.js';
import { AskQuestion } from './application/use-cases/ask-question.js';
import { GetHistory, ClearHistory } from './application/use-cases/manage-history.js';
import {
  ChangeOwnPassword, CreateAdminUser, DeleteAdminUser, ListAdminUsers, LoginAdmin, ResetAdminPassword, ResolveAdminSession, SeedAdminUser,
} from './application/use-cases/admin-auth.js';
import { SearchKnowledge } from './application/use-cases/search-knowledge.js';
import { ListKnowledge, GetKnowledge, SaveKnowledge, DeleteKnowledge } from './application/use-cases/manage-knowledge.js';
import { FileDocumentSource } from './infrastructure/knowledge/file-document-source.js';
import { InMemoryChatHistory } from './infrastructure/persistence/in-memory-chat-history.js';
import { ChatController } from './interface/http/chat-controller.js';
import { AdminKnowledgeController } from './interface/http/admin-knowledge-controller.js';
import { AdminAccountController } from './interface/http/admin-account-controller.js';
import { createTokenAuthenticator } from './interface/http/admin-auth.js';
import { ScryptPasswordHasher } from './infrastructure/security/scrypt-password-hasher.js';
import { HmacSessionTokens } from './infrastructure/security/hmac-session-tokens.js';
import { InMemoryLoginThrottle } from './infrastructure/security/in-memory-login-throttle.js';
import { createServer } from './interface/http/server.js';

/**
 * Composition root: merakit use case, controller, dan server dari port yang diberikan.
 * Implementasi konkret (file/PostgreSQL, TF-IDF/pgvector, LLM) dipilih di bootstrap.js.
 */
export async function buildApp({
  repository, adminUsers, retriever, answerGenerator, minScore, seed = true, seedDir, publicDir,
  adminToken, bootstrapAdmin = {}, sessionSecret = randomBytes(32).toString('hex'), sessionTtlSeconds = 12 * 3600,
  trustProxy = false, cookieSecure = 'auto', hasher = new ScryptPasswordHasher(), throttle = new InMemoryLoginThrottle(),
}) {
  const history = new InMemoryChatHistory();
  const reindex = new ReindexKnowledge({ repository, retriever });

  const sessions = new HmacSessionTokens({ secret: sessionSecret, ttlSeconds: sessionTtlSeconds });
  const seededAdmin = await new SeedAdminUser({ users: adminUsers, hasher, newId: randomUUID }).execute(bootstrapAdmin);

  const seeded = seed ? await new SeedKnowledge({ repository, documentSource: new FileDocumentSource(seedDir) }).execute() : 0;
  const stats = await reindex.execute();

  const server = createServer({
    chat: new ChatController({
      askQuestion: new AskQuestion({
        retriever, answerGenerator, history, minScore,
        topics: { titles: async () => (await repository.list()).filter((d) => d.enabled).map((d) => d.title) },
      }),
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
    adminAccounts: new AdminAccountController({
      loginAdmin: new LoginAdmin({ users: adminUsers, hasher, sessions, throttle }),
      changeOwnPassword: new ChangeOwnPassword({ users: adminUsers, hasher, sessions }),
      listAdminUsers: new ListAdminUsers({ users: adminUsers }),
      createAdminUser: new CreateAdminUser({ users: adminUsers, hasher, newId: randomUUID }),
      deleteAdminUser: new DeleteAdminUser({ users: adminUsers }),
      resetAdminPassword: new ResetAdminPassword({ users: adminUsers, hasher }),
    }),
    resolveSession: new ResolveAdminSession({ users: adminUsers, sessions }),
    authenticateBearer: createTokenAuthenticator(adminToken),
    sessionTtlSeconds,
    trustProxy,
    cookieSecure,
    publicDir,
  });
  return { server, stats, seeded, seededAdmin };
}
