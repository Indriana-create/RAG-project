import path from 'node:path';
import pg from 'pg';
import { TfidfRetriever } from './infrastructure/retrieval/tfidf-retriever.js';
import { PgVectorRetriever } from './infrastructure/retrieval/pgvector-retriever.js';
import { JsonFileKnowledgeRepository } from './infrastructure/persistence/json-file-knowledge-repository.js';
import { PostgresKnowledgeRepository } from './infrastructure/persistence/postgres/postgres-knowledge-repository.js';
import { migrateDocuments } from './infrastructure/persistence/postgres/schema.js';
import { ExtractiveAnswerGenerator } from './infrastructure/generation/extractive-answer-generator.js';
import { AnthropicAnswerGenerator } from './infrastructure/generation/anthropic-answer-generator.js';
import { OpenAiCompatibleAnswerGenerator } from './infrastructure/generation/openai-compatible-answer-generator.js';
import { OpenAiCompatibleEmbedder } from './infrastructure/embedding/openai-compatible-embedder.js';

const DEFAULT_MIN_SCORE = { tfidf: 0.05, vector: 0.35 };

const sslFrom = (value) => {
  if (value === 'true') return { rejectUnauthorized: true };
  if (value === 'no-verify') return { rejectUnauthorized: false };
  return undefined;
};

/**
 * Memilih implementasi konkret dari environment:
 *  - DATABASE_URL        → PostgreSQL (tanpa → file JSON lokal)
 *  - EMBEDDING_MODEL     → pencarian semantik pgvector (tanpa → TF-IDF)
 *  - LLM_BASE_URL        → LLM lokal OpenAI-compatible (lalu ANTHROPIC_API_KEY, lalu ekstraktif)
 */
export async function createDependencies(env, { logger = console } = {}) {
  const closers = [];
  let repository;
  let retriever;
  let mode = 'tfidf';

  const embedder = env.EMBEDDING_MODEL
    ? new OpenAiCompatibleEmbedder({
      baseUrl: env.EMBEDDING_BASE_URL || env.LLM_BASE_URL,
      model: env.EMBEDDING_MODEL,
      apiKey: env.EMBEDDING_API_KEY || env.LLM_API_KEY,
      batchSize: Number(env.EMBEDDING_BATCH_SIZE) || 16,
    })
    : null;

  if (env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: sslFrom(env.DATABASE_SSL), max: Number(env.DATABASE_POOL_MAX) || 10 });
    closers.push(() => pool.end());
    try {
      await migrateDocuments(pool);
      repository = new PostgresKnowledgeRepository(pool);
      if (embedder) {
        retriever = await PgVectorRetriever.create({
          pool, embedder, docPrefix: env.EMBEDDING_DOC_PREFIX ?? '', queryPrefix: env.EMBEDDING_QUERY_PREFIX ?? '', logger,
        });
        mode = 'vector';
      } else {
        retriever = new TfidfRetriever();
      }
    } catch (err) {
      await Promise.all(closers.map((close) => close()));
      throw err;
    }
  } else {
    if (embedder) throw new Error('EMBEDDING_MODEL membutuhkan DATABASE_URL (PostgreSQL + pgvector)');
    repository = new JsonFileKnowledgeRepository(path.join(env.DATA_DIR ?? './data', 'knowledge.json'));
    retriever = new TfidfRetriever();
  }

  let answerGenerator;
  let generatorName;
  if (env.LLM_BASE_URL) {
    answerGenerator = new OpenAiCompatibleAnswerGenerator({
      baseUrl: env.LLM_BASE_URL,
      model: env.LLM_MODEL,
      apiKey: env.LLM_API_KEY,
      temperature: env.LLM_TEMPERATURE === undefined || env.LLM_TEMPERATURE === '' ? undefined : Number(env.LLM_TEMPERATURE),
      maxTokens: Number(env.LLM_MAX_TOKENS) || undefined,
      timeoutMs: Number(env.LLM_TIMEOUT_MS) || undefined,
    });
    generatorName = `LLM lokal (${env.LLM_MODEL} @ ${env.LLM_BASE_URL})`;
  } else if (env.ANTHROPIC_API_KEY) {
    answerGenerator = new AnthropicAnswerGenerator({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' });
    generatorName = 'Claude API';
  } else {
    answerGenerator = new ExtractiveAnswerGenerator();
    generatorName = 'ekstraktif (offline)';
  }

  const minScore = env.MIN_SCORE ? Number(env.MIN_SCORE) : DEFAULT_MIN_SCORE[mode];
  if (Number.isNaN(minScore)) throw new Error('MIN_SCORE harus berupa angka');

  return {
    repository,
    retriever,
    answerGenerator,
    minScore,
    seed: env.SEED_ON_EMPTY !== 'false',
    description: {
      storage: env.DATABASE_URL ? 'PostgreSQL' : 'file JSON',
      retrieval: mode === 'vector' ? `pgvector (${env.EMBEDDING_MODEL})` : 'TF-IDF',
      generator: generatorName,
      minScore,
    },
    close: () => Promise.all(closers.map((close) => close())),
  };
}
