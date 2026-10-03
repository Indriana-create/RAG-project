import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildApp } from './composition.js';
import { AnthropicAnswerGenerator } from './infrastructure/generation/anthropic-answer-generator.js';
import { ExtractiveAnswerGenerator } from './infrastructure/generation/extractive-answer-generator.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  PORT = 3000,
  DATA_DIR = path.join(root, 'data'),
  KNOWLEDGE_DIR = path.join(root, 'knowledge'),
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL = 'claude-sonnet-5-5',
} = process.env;

let adminToken = process.env.ADMIN_TOKEN;
if (!adminToken) {
  adminToken = randomBytes(16).toString('hex');
  console.warn(`ADMIN_TOKEN tidak diset. Token sementara (berubah tiap restart): ${adminToken}`);
}

const answerGenerator = ANTHROPIC_API_KEY
  ? new AnthropicAnswerGenerator({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL })
  : new ExtractiveAnswerGenerator();

const { server, stats, seeded } = await buildApp({
  dataDir: DATA_DIR, seedDir: KNOWLEDGE_DIR, publicDir: path.join(root, 'src/interface/web'), adminToken, answerGenerator,
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT} — ${stats.documents} dokumen aktif, ${stats.chunks} chunk${seeded ? ` (${seeded} dokumen awal diimpor)` : ''}`);
  console.log(`Admin: http://localhost:${PORT}/admin.html — generator: ${ANTHROPIC_API_KEY ? 'Claude' : 'ekstraktif (offline)'}`);
});
