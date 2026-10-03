import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildApp } from './composition.js';
import { createDependencies } from './bootstrap.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  DATA_DIR: process.env.DATA_DIR ?? path.join(root, 'data'),
};
const { PORT = 3000, HOST, KNOWLEDGE_DIR = path.join(root, 'knowledge') } = env;

let adminToken = env.ADMIN_TOKEN;
if (!adminToken) {
  adminToken = randomBytes(16).toString('hex');
  console.warn(`ADMIN_TOKEN tidak diset. Token sementara (berubah tiap restart): ${adminToken}`);
}

const deps = await createDependencies(env);
const { server, stats, seeded } = await buildApp({
  ...deps,
  seedDir: KNOWLEDGE_DIR,
  publicDir: path.join(root, 'src/interface/web'),
  adminToken,
});

const onListening = () => {
  const { storage, retrieval, generator, minScore } = deps.description;
  console.log(`http://localhost:${PORT} — ${stats.documents} dokumen aktif, ${stats.chunks} chunk${seeded ? ` (${seeded} dokumen awal diimpor)` : ''}`);
  console.log(`Admin: http://localhost:${PORT}/admin.html`);
  console.log(`Penyimpanan: ${storage} | Pencarian: ${retrieval} (ambang ${minScore}) | Jawaban: ${generator}`);
};
// HOST=127.0.0.1 membatasi akses ke mesin ini saja (mis. di belakang reverse proxy / SSH tunnel).
if (HOST) server.listen(PORT, HOST, onListening);
else server.listen(PORT, onListening);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(async () => { await deps.close(); process.exit(0); });
    server.closeAllConnections?.();
  });
}
