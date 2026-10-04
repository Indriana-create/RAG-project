import { randomBytes, randomUUID } from 'node:crypto';
import { ReindexKnowledge } from './application/use-cases/reindex-knowledge.js';
import { SeedKnowledge } from './application/use-cases/seed-knowledge.js';
import { AskQuestion } from './application/use-cases/ask-question.js';
import { GetHistory, ClearHistory } from './application/use-cases/manage-history.js';
import {
  ApproveAdminUser, ChangeOwnPassword, CreateAdminUser, DeleteAdminUser, ListAdminUsers, LoginAdmin, RegisterAccount, ResetAdminPassword, UpdateAdminProfile, ResolveAdminSession, SeedAdminUser,
} from './application/use-cases/admin-auth.js';
import { AssistantSettingsService } from './application/use-cases/assistant-settings.js';
import { GenerateSuggestions, GetSuggestions, TranslateSuggestions, completeSuggestionSet } from './application/use-cases/suggestions.js';
import { SearchKnowledge } from './application/use-cases/search-knowledge.js';
import { findSourceUrl } from './domain/web-url.js';
import { ExtractDocumentText } from './application/use-cases/extract-document-text.js';
import { createDocumentTextExtractor } from './infrastructure/documents/index.js';
import { CrawlWebsite, ImportKnowledgeFromUrl } from './application/use-cases/import-from-url.js';
import { SafeFetcher } from './infrastructure/web/safe-fetcher.js';
import { WebPageReader } from './infrastructure/web/web-page-reader.js';
import { ListKnowledge, GetKnowledge, SaveKnowledge, DeleteKnowledge } from './application/use-cases/manage-knowledge.js';
import { FileDocumentSource } from './infrastructure/knowledge/file-document-source.js';
import { InMemoryChatHistory } from './infrastructure/persistence/in-memory-chat-history.js';
import { ChatController } from './interface/http/chat-controller.js';
import { AdminKnowledgeController } from './interface/http/admin-knowledge-controller.js';
import { AdminAssistantController } from './interface/http/admin-assistant-controller.js';
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
  repository, adminUsers, settings, assistantDefaults = { name: 'Asisten Virtual', style: '' }, retriever, answerGenerator, minScore, topK = 6, seed = true, seedDir, publicDir,
  adminToken, bootstrapAdmin = {}, sessionSecret = randomBytes(32).toString('hex'), sessionTtlSeconds = 12 * 3600,
  trustProxy = false, cookieSecure = 'auto', allowPrivateUrls = false, urlFetcher, hasher = new ScryptPasswordHasher(), throttle = new InMemoryLoginThrottle(),
}) {
  const history = new InMemoryChatHistory();
  const reindex = new ReindexKnowledge({ repository, retriever });

  const documentExtractor = createDocumentTextExtractor();
  const webReader = new WebPageReader({ fetcher: urlFetcher ?? new SafeFetcher({ allowPrivate: allowPrivateUrls }), documentExtractor });
  const assistant = new AssistantSettingsService({ repository: settings, defaults: assistantDefaults });
  const sessions = new HmacSessionTokens({ secret: sessionSecret, ttlSeconds: sessionTtlSeconds });
  const seededAdmin = await new SeedAdminUser({ users: adminUsers, hasher, newId: randomUUID }).execute(bootstrapAdmin);

  const seeded = seed ? await new SeedKnowledge({ repository, documentSource: new FileDocumentSource(seedDir) }).execute() : 0;
  const stats = await reindex.execute();

  const server = createServer({
    chat: new ChatController({
      askQuestion: new AskQuestion({
        retriever, answerGenerator, history, minScore, topK, personas: assistant,
        sourceLinks: {
          urls: async (ids) => {
            const out = {};
            for (const id of ids) { const url = findSourceUrl((await repository.get(id))?.content); if (url) out[id] = url; }
            return out;
          },
        },
        topics: { titles: async () => (await repository.list()).filter((d) => d.enabled).map((d) => d.title) },
      }),
      getHistory: new GetHistory({ history }),
      clearHistory: new ClearHistory({ history }),
      getSuggestions: new GetSuggestions({ assistant, repository }),
    }),
    adminKnowledge: new AdminKnowledgeController({
      listKnowledge: new ListKnowledge({ repository }),
      getKnowledge: new GetKnowledge({ repository }),
      saveKnowledge: new SaveKnowledge({ repository, reindex, newId: randomUUID }),
      deleteKnowledge: new DeleteKnowledge({ repository, reindex }),
      searchKnowledge: new SearchKnowledge({ retriever, minScore, topK }),
      extractDocumentText: new ExtractDocumentText({ extractor: documentExtractor }),
      importFromUrl: new ImportKnowledgeFromUrl({ reader: webReader }),
      crawlWebsite: new CrawlWebsite({ reader: webReader }),
    }),
    adminAssistant: new AdminAssistantController({
      assistant,
      generateSuggestions: new GenerateSuggestions({ repository, generator: answerGenerator }),
      translateSuggestions: new TranslateSuggestions({ generator: answerGenerator }),
      completeSuggestions: (set, options) => completeSuggestionSet(answerGenerator, set, options),
    }),
    adminAccounts: new AdminAccountController({
      loginAdmin: new LoginAdmin({ users: adminUsers, hasher, sessions, throttle }),
      changeOwnPassword: new ChangeOwnPassword({ users: adminUsers, hasher, sessions }),
      listAdminUsers: new ListAdminUsers({ users: adminUsers }),
      createAdminUser: new CreateAdminUser({ users: adminUsers, hasher, newId: randomUUID }),
      deleteAdminUser: new DeleteAdminUser({ users: adminUsers }),
      resetAdminPassword: new ResetAdminPassword({ users: adminUsers, hasher }),
      registerAccount: new RegisterAccount({ users: adminUsers, hasher, newId: randomUUID, throttle }),
      approveAdminUser: new ApproveAdminUser({ users: adminUsers }),
      updateAdminProfile: new UpdateAdminProfile({ users: adminUsers }),
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
