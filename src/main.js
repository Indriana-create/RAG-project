import path from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildApp } from './composition.js';
import { createDependencies } from './bootstrap.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  DATA_DIR: process.env.DATA_DIR ?? path.join(root, 'data'),
};
const { PORT = 3000, HOST, KNOWLEDGE_DIR = path.join(root, 'knowledge') } = env;

// Rahasia penanda sesi: SESSION_SECRET, atau diturunkan dari ADMIN_TOKEN (stabil antar restart), atau acak (sesi hilang saat restart).
let sessionSecret = env.SESSION_SECRET;
if (!sessionSecret && env.ADMIN_TOKEN) sessionSecret = createHmac('sha256', env.ADMIN_TOKEN).update('rag-session-secret').digest('hex');
if (!sessionSecret) {
  sessionSecret = randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET/ADMIN_TOKEN tidak diset: admin harus login ulang setiap aplikasi restart.');
}
const ttlHours = Number(env.SESSION_TTL_HOURS) || 12;

const deps = await createDependencies(env);
const { server, stats, seeded, seededAdmin } = await buildApp({
  ...deps,
  seedDir: KNOWLEDGE_DIR,
  publicDir: path.join(root, 'src/interface/web'),
  adminToken: env.ADMIN_TOKEN, // opsional: hanya untuk otomasi (Authorization: Bearer ...)
  bootstrapAdmin: { username: env.ADMIN_USERNAME || 'admin', password: env.ADMIN_PASSWORD || undefined },
  sessionSecret,
  sessionTtlSeconds: ttlHours * 3600,
  trustProxy: env.TRUST_PROXY === 'true',
  cookieSecure: env.COOKIE_SECURE || 'auto',
});

if (seededAdmin.created) {
  console.log(`Akun admin pertama dibuat: username "${seededAdmin.username}".`);
  if (seededAdmin.generatedPassword) {
    console.warn(`ADMIN_PASSWORD tidak diset. Password sementara (hanya tampil sekali): ${seededAdmin.generatedPassword}`);
    console.warn('Segera login lalu ubah lewat menu "Ubah password".');
  }
}

const onListening = () => {
  const { storage, retrieval, generator, minScore } = deps.description;
  console.log(`http://localhost:${PORT} — ${stats.documents} dokumen aktif, ${stats.chunks} chunk${seeded ? ` (${seeded} dokumen awal diimpor)` : ''}`);
  console.log(`Admin: http://localhost:${PORT}/admin.html | API token otomasi: ${env.ADMIN_TOKEN ? 'aktif' : 'nonaktif'}`);
  console.log(`Penyimpanan: ${storage} | Pencarian: ${retrieval} (ambang ${minScore}) | Jawaban: ${generator}`);
  if (deps.description.semantic && !deps.description.minScoreCalibrated) {
    console.warn('MIN_SCORE belum diset: ambang sementara dipakai. Skor kemiripan embedding berbeda tiap model; kalibrasi dengan scripts/calibrate.mjs (lihat README).');
  }
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
